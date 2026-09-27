import type { WebSocket } from 'ws';
import type { PrismaService } from '../prisma/prisma.service';
import { ChildRealtimeService } from './child-realtime.service';

interface MockWs {
  OPEN: number;
  readyState: number;
  sent: Array<{ op: string; id?: string; data?: Record<string, string> }>;
  send: jest.Mock;
  close: jest.Mock;
  terminate: jest.Mock;
}

function makeWs(): MockWs {
  const ws: MockWs = {
    OPEN: 1,
    readyState: 1,
    sent: [],
    send: jest.fn((raw: string) => {
      ws.sent.push(JSON.parse(raw));
    }),
    close: jest.fn(() => {
      ws.readyState = 3;
    }),
    terminate: jest.fn(() => {
      ws.readyState = 3;
    }),
  };
  return ws;
}

const asWs = (m: MockWs) => m as unknown as WebSocket;

describe('ChildRealtimeService', () => {
  let updateMany: jest.Mock;
  let svc: ChildRealtimeService;

  beforeEach(() => {
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    svc = new ChildRealtimeService({
      deviceCommand: { updateMany },
    } as unknown as PrismaService);
  });

  it('устройства нет на связи → false без отправки', async () => {
    await expect(svc.sendWithAck('d1', { type: 'PLAY_SIGNAL' })).resolves.toBe(false);
  });

  it('ack пришёл → true и команда помечается выполненной', async () => {
    const ws = makeWs();
    svc.register('d1', asWs(ws));
    const p = svc.sendWithAck('d1', { type: 'START_AUDIO', commandId: 'c1', sessionId: 's1' });
    expect(ws.sent[0]).toMatchObject({ op: 'push', data: { type: 'START_AUDIO' } });
    svc.handleAck('d1', ws.sent[0].id as string);
    await expect(p).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', childDeviceId: 'd1', status: 'pending' },
      data: { status: 'executed', executedAt: expect.any(Date) },
    });
  });

  it('без commandId в БД ничего не пишем', async () => {
    const ws = makeWs();
    svc.register('d1', asWs(ws));
    const p = svc.sendWithAck('d1', { type: 'SYNC_RULES' });
    svc.handleAck('d1', ws.sent[0].id as string);
    await expect(p).resolves.toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('нет ack за таймаут → false, сокет рвётся и снимается с учёта', async () => {
    const ws = makeWs();
    svc.register('d1', asWs(ws));
    await expect(svc.sendWithAck('d1', { type: 'PLAY_SIGNAL' }, 20)).resolves.toBe(false);
    expect(ws.terminate).toHaveBeenCalled();
    expect(svc.isConnected('d1')).toBe(false);
  });

  it('ack с чужим id не засчитывается', async () => {
    const ws = makeWs();
    svc.register('d1', asWs(ws));
    const p = svc.sendWithAck('d1', { type: 'PLAY_SIGNAL' }, 20);
    svc.handleAck('d1', 'other');
    await expect(p).resolves.toBe(false);
  });

  it('новое соединение вытесняет старое, unregister старого не трогает новое', () => {
    const a = makeWs();
    const b = makeWs();
    svc.register('d1', asWs(a));
    svc.register('d1', asWs(b));
    expect(a.close).toHaveBeenCalledWith(4000, 'replaced');
    svc.unregister('d1', asWs(a));
    expect(svc.isConnected('d1')).toBe(true);
    svc.unregister('d1', asWs(b));
    expect(svc.isConnected('d1')).toBe(false);
  });

  it('onDeviceConnected вызывается при регистрации', () => {
    const cb = jest.fn();
    svc.onDeviceConnected(cb);
    svc.register('d7', asWs(makeWs()));
    expect(cb).toHaveBeenCalledWith('d7');
  });
});
