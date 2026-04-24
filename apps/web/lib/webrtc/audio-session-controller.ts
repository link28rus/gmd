// apps/web/lib/webrtc/audio-session-controller.ts
import type { TurnCreds } from '@/lib/api/audio';

export type AudioControllerState = 'idle' | 'negotiating' | 'active' | 'ended' | 'failed';

type PcFactory = (config: RTCConfiguration) => RTCPeerConnection;

interface Params {
  sessionId: string;
  turnCreds: TurnCreds;
  sendAnswer: (sessionId: string, sdp: string) => Promise<void>;
  sendIce: (sessionId: string, candidate: string) => Promise<void>;
  onStateChange: (state: AudioControllerState) => void;
  onRemoteStream: (stream: MediaStream) => void;
  /** Инъекция фабрики для тестов. По умолчанию native RTCPeerConnection. */
  pcFactory?: PcFactory;
}

/**
 * Инкапсулирует WebRTC state-machine на стороне parent.
 * НЕ завязан на React — легко тестируется.
 *
 * Протокол signaling (см. docs/audio-api.md §9.1):
 *   1. Backend → SSE event READY {sdp}     → handleReadyOffer(sdp)
 *   2. Backend → SSE event ICE_FROM_CHILD  → handleIceFromChild(candidate)
 *   3. Local onicecandidate                → sendIce(candidate)
 *   4. Remote ontrack                      → onRemoteStream(stream)
 *   5. Backend → ENDED/FAILED/EXPIRED      → stop()
 */
export class AudioSessionController {
  private pc: RTCPeerConnection | null = null;
  private readonly factory: PcFactory;

  constructor(private readonly params: Params) {
    this.factory = params.pcFactory ?? ((cfg) => new RTCPeerConnection(cfg));
  }

  init(): void {
    const config: RTCConfiguration = {
      iceServers: [
        {
          urls: this.params.turnCreds.url,
          username: this.params.turnCreds.username,
          credential: this.params.turnCreds.password,
        },
      ],
      iceTransportPolicy: 'relay',
    };

    this.pc = this.factory(config);

    // NOTE: НЕ добавляем `addTransceiver('audio', {direction: 'recvonly'})` заранее.
    // Plan E E2E показал: это создаёт лишний transceiver без mid → после
    // setRemoteDescription(offer) Chrome добавляет второй transceiver с mid="0"
    // от m-line child'а, получается два m-секции в answer SDP, ICE candidates от
    // child не matched правильно, connectionState застревает в "new".
    // Направление `recvonly` теперь приходит из SDP child (он шлёт sendonly) →
    // transceiver создаётся автоматически в setRemoteDescription уже с mid.

    this.pc.onicecandidate = (e) => {
      if (e.candidate?.candidate) {
        // Оборачиваем в Promise.resolve — sendIce может вернуть undefined
        // (например, в тестах с jest.fn() без mockResolvedValue).
        void Promise.resolve(
          this.params.sendIce(this.params.sessionId, e.candidate.candidate),
        ).catch(() => {
          /* ICE-кандидаты лучше терять, чем ломать сессию */
        });
      }
    };

    this.pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (stream) this.params.onRemoteStream(stream);
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      // 'disconnected' часто транзиентный (краткая потеря ICE, затем recovery до
      // 'connected'). Считаем провалом только терминальные 'failed'/'closed'.
      if (s === 'connected') this.params.onStateChange('active');
      else if (s === 'failed') this.params.onStateChange('failed');
      else if (s === 'closed') this.params.onStateChange('ended');
    };

    this.params.onStateChange('negotiating');
  }

  async handleReadyOffer(sdpOffer: string): Promise<void> {
    if (!this.pc) throw new Error('Controller not initialized');
    await this.pc.setRemoteDescription({ type: 'offer', sdp: sdpOffer });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    if (answer.sdp) {
      await this.params.sendAnswer(this.params.sessionId, answer.sdp);
    }
  }

  async handleIceFromChild(candidate: string): Promise<void> {
    if (!this.pc) return;
    await this.pc.addIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 }).catch(() => {
      /* Поздние ICE иногда приходят после close — игнор */
    });
  }

  stop(): void {
    this.pc?.close();
    this.pc = null;
  }
}
