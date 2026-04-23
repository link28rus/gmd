/** @jest-environment jsdom */
import { AudioSessionController } from './audio-session-controller';
import type { TurnCreds } from '@/lib/api/audio';

class FakeRTCPeerConnection {
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((e: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((e: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  addedCandidates: RTCIceCandidateInit[] = [];
  closed = false;

  constructor(public readonly config: RTCConfiguration) {}

  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    this.remoteDescription = desc;
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'v=0\r\n[answer sdp]' };
  }
  async setLocalDescription(desc: RTCSessionDescriptionInit) {
    this.localDescription = desc;
  }
  async addIceCandidate(c: RTCIceCandidateInit) {
    this.addedCandidates.push(c);
  }
  addTransceiver(_kind: string, _init: RTCRtpTransceiverInit) {}
  close() {
    this.closed = true;
  }
}

describe('AudioSessionController', () => {
  const turnCreds: TurnCreds = {
    url: 'turn:t.example:3478',
    username: 'u',
    password: 'p',
    ttl: 360,
  };
  let pcFactory: jest.Mock;
  let pc: FakeRTCPeerConnection;

  beforeEach(() => {
    pc = new FakeRTCPeerConnection({});
    pcFactory = jest.fn((cfg: RTCConfiguration) => {
      (pc as unknown as { config: RTCConfiguration }).config = cfg;
      return pc as unknown as RTCPeerConnection;
    });
  });

  it('init создаёт PC с iceServers=[turnCreds] и policy=relay', () => {
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();

    expect(pcFactory).toHaveBeenCalledTimes(1);
    const cfg = pcFactory.mock.calls[0][0] as RTCConfiguration;
    expect(cfg.iceTransportPolicy).toBe('relay');
    expect(cfg.iceServers).toEqual([
      { urls: 'turn:t.example:3478', username: 'u', credential: 'p' },
    ]);
  });

  it('handleReady: setRemoteDescription(offer) → createAnswer → setLocalDescription → sendAnswer', async () => {
    const sendAnswer = jest.fn().mockResolvedValue(undefined);
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer,
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();
    await c.handleReadyOffer('v=0\r\n[offer]');

    expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'v=0\r\n[offer]' });
    expect(pc.localDescription).toEqual({ type: 'answer', sdp: 'v=0\r\n[answer sdp]' });
    expect(sendAnswer).toHaveBeenCalledWith('sess-1', 'v=0\r\n[answer sdp]');
  });

  it('handleIceFromChild: addIceCandidate с sdpMid="0" и sdpMLineIndex=0', async () => {
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();
    await c.handleIceFromChild('candidate:0 1 UDP ...');
    expect(pc.addedCandidates).toEqual([
      { candidate: 'candidate:0 1 UDP ...', sdpMid: '0', sdpMLineIndex: 0 },
    ]);
  });

  it('onicecandidate пробрасывает candidate в sendIce', () => {
    const sendIce = jest.fn();
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce,
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();

    const fakeCand = { candidate: 'candidate:1 1 UDP ...' } as unknown as RTCIceCandidate;
    pc.onicecandidate?.({ candidate: fakeCand } as RTCPeerConnectionIceEvent);

    expect(sendIce).toHaveBeenCalledWith('sess-1', 'candidate:1 1 UDP ...');
  });

  it('ontrack → onRemoteStream вызывается с MediaStream', () => {
    const onRemoteStream = jest.fn();
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream,
      pcFactory,
    });
    c.init();

    const fakeStream = {} as MediaStream;
    pc.ontrack?.({ streams: [fakeStream] } as unknown as RTCTrackEvent);

    expect(onRemoteStream).toHaveBeenCalledWith(fakeStream);
  });

  it('stop() закрывает PC', () => {
    const c = new AudioSessionController({
      sessionId: 'sess-1',
      turnCreds,
      sendAnswer: jest.fn(),
      sendIce: jest.fn(),
      onStateChange: jest.fn(),
      onRemoteStream: jest.fn(),
      pcFactory,
    });
    c.init();
    c.stop();
    expect(pc.closed).toBe(true);
  });
});
