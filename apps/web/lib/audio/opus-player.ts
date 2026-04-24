import { OpusDecoder } from 'opus-decoder';

/**
 * Web parent player для «Звук вокруг» (v0.35).
 *
 * Поток данных:
 *   WebSocket(/audio/ws?role=parent&...)
 *      ─ binary frame: Opus-пакет (20 ms, 16 kHz mono на child'е)
 *      └→ OpusDecoder (opus-decoder, WASM, выходной sampleRate = 48 kHz)
 *           └→ AudioWorkletNode('audio-player') — ring buffer + plays
 *                └→ MediaStreamAudioDestinationNode → MediaStream
 *                     └→ <audio>.srcObject + createVuMeter()
 *
 * Почему именно так:
 *  - AudioWorklet вместо ScriptProcessorNode: первый — низкая латентность, второй deprecated.
 *  - postMessage Float32Array вместо SharedArrayBuffer: нам не нужны COOP/COEP заголовки,
 *    которые ломают сторонние скрипты (Yandex Metrika и т. п.). 20-мс фрейм = 3.75 KB,
 *    cost message-passing в районе 0.05 мс — пренебрежимо.
 *  - MediaStreamDestination: позволяет переиспользовать существующий <audio>+VU-meter UI
 *    без переписывания (контракт useAudioSession.mediaStream сохраняется).
 *
 * Управление состоянием — через события onStateChange:
 *  - 'connecting' → 'connected' (WS open) → 'streaming' (первый decoded frame) → 'closed' (WS close)
 *  - 'error' — fatal (decoder init / worklet load); WS-ошибки сообщаются через onCloseCode.
 */

export type OpusPlayerState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'closed'
  | 'error';

export interface OpusPlayerEvents {
  onStateChange?: (state: OpusPlayerState) => void;
  onError?: (err: Error) => void;
  /** WS закрылся — code/reason (RFC 6455 + наши приватные 4xxx, см. backend audio-ws.dto.ts). */
  onCloseCode?: (code: number, reason: string) => void;
  /** Backend прислал control-frame {op:'error'} — обычно ретранслируется ошибка child'а. */
  onChildError?: (code: string, message?: string) => void;
}

const CONNECT_TIMEOUT_MS = 10_000;
const SAMPLE_RATE = 48_000;

export class WebAudioOpusPlayer {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private decoder: OpusDecoder | null = null;
  private gotFirstFrame = false;
  private currentState: OpusPlayerState = 'idle';
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly events: OpusPlayerEvents = {},
  ) {}

  get state(): OpusPlayerState {
    return this.currentState;
  }

  getMediaStream(): MediaStream | null {
    return this.destination?.stream ?? null;
  }

  /**
   * Поднимает AudioContext, worklet, decoder и WS.
   * Resolve'ится с MediaStream сразу после WS open (поток уже подключён к destination,
   * данные потекут как только child пришлёт первый Opus-фрейм).
   */
  async start(): Promise<MediaStream> {
    this.setState('connecting');
    try {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      // На некоторых браузерах AudioContext стартует suspended, если страница
      // не получила user gesture — у нас диалог открывается по клику, должно быть ok.
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      await this.ctx.audioWorklet.addModule('/audio-player-worklet.js');
      this.workletNode = new AudioWorkletNode(this.ctx, 'audio-player', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.destination = this.ctx.createMediaStreamDestination();
      this.workletNode.connect(this.destination);

      // sampleRate опускаем — default opus-decoder = 48000 (совпадает с AudioContext).
      // Если указать sampleRate явно, generic OpusDecoder<48000> не совпадёт с
      // полем OpusDecoder | null без явного cast.
      const decoder = new OpusDecoder({ channels: 1 });
      await decoder.ready;
      this.decoder = decoder;
    } catch (err) {
      this.setState('error');
      this.cleanupAudio();
      const e = err instanceof Error ? err : new Error(String(err));
      this.events.onError?.(e);
      throw e;
    }

    return new Promise<MediaStream>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        const e = err instanceof Error ? err : new Error('WebSocket constructor failed');
        this.setState('error');
        this.cleanupAudio();
        this.events.onError?.(e);
        reject(e);
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      this.connectTimer = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.close();
          // close handler сам сделает cleanup и эмит close-code 1006 (abnormal).
          reject(new Error('WS connect timeout'));
        }
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        this.setState('connected');
        if (!this.destination) {
          // Не должно случиться — cleanup() выполнился между start() и onopen?
          reject(new Error('destination not ready'));
          return;
        }
        resolve(this.destination.stream);
      };

      ws.onmessage = (e) => this.handleMessage(e.data as ArrayBuffer | string);

      ws.onerror = () => {
        // В onerror у браузеров приходит просто Event без подробностей; реальный
        // close-code будет в onclose. Молча — onclose зарепортит.
      };

      ws.onclose = (e) => {
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        this.setState('closed');
        this.events.onCloseCode?.(e.code, e.reason);
        this.cleanupAudio();
      };
    });
  }

  /**
   * Остановить проигрывание. Идемпотентно. Шлёт WS close 1000 (normal),
   * чистит audio chain. После stop() инстанс одноразовый — для новой сессии create new.
   */
  stop(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close(1000, 'parent_stop');
      } catch {
        /* ignore */
      }
    }
    this.ws = null;
    this.cleanupAudio();
  }

  private cleanupAudio(): void {
    try {
      this.workletNode?.port.postMessage({ type: 'reset' });
    } catch {
      /* ignore */
    }
    this.workletNode?.disconnect();
    this.workletNode = null;
    this.destination?.disconnect();
    this.destination = null;
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close().catch(() => {
        /* ignore */
      });
    }
    this.ctx = null;
    if (this.decoder) {
      try {
        this.decoder.free();
      } catch {
        /* ignore */
      }
    }
    this.decoder = null;
  }

  private handleMessage(data: ArrayBuffer | string): void {
    if (typeof data === 'string') {
      this.handleControl(data);
      return;
    }
    if (!this.decoder || !this.workletNode) return;
    try {
      const opus = new Uint8Array(data);
      const decoded = this.decoder.decodeFrame(opus);
      if (!decoded || decoded.samplesDecoded === 0) return;
      const channel = decoded.channelData[0];
      // Transfer ownership чтобы избежать лишнего copy. opus-decoder каждый фрейм
      // отдаёт новый Float32Array — безопасно transferить.
      this.workletNode.port.postMessage(channel, [channel.buffer]);
      if (!this.gotFirstFrame) {
        this.gotFirstFrame = true;
        this.setState('streaming');
      }
    } catch (err) {
      this.events.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleControl(text: string): void {
    let msg: { op?: string; state?: string; code?: string; message?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.op === 'error' && typeof msg.code === 'string') {
      this.events.onChildError?.(msg.code, msg.message);
    }
    // 'hello' / 'state' / 'bye' — пока не используем явно; реальные state-changes
    // приходят через WS close-code (4006/4008/4404 etc).
  }

  private setState(s: OpusPlayerState): void {
    if (this.currentState === s) return;
    this.currentState = s;
    this.events.onStateChange?.(s);
  }
}
