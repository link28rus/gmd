import type { WebSocket as WsSocket } from 'ws';
import { AudioRelay } from './audio.relay';

// Минимальный mock WebSocket — только те поля, что использует relay.
interface MockWs {
  readyState: number;
  bufferedAmount: number;
  sent: Array<{ data: Buffer; binary: boolean }>;
  closed: { code: number; reason: string } | null;
  send: jest.Mock;
  close: jest.Mock;
}

function makeWs(bufferedAmount = 0): MockWs {
  const sent: MockWs['sent'] = [];
  const ws: MockWs = {
    readyState: 1,
    bufferedAmount,
    sent,
    closed: null,
    send: jest.fn((data: Buffer, opts?: { binary?: boolean }) => {
      sent.push({ data, binary: opts?.binary ?? false });
    }),
    close: jest.fn((code: number, reason: string) => {
      ws.closed = { code, reason };
      ws.readyState = 3; // CLOSED
    }),
  };
  return ws;
}

describe('AudioRelay', () => {
  let relay: AudioRelay;

  beforeEach(() => {
    relay = new AudioRelay();
  });

  describe('attach + activation', () => {
    it('emits onActivate when both producer and consumer присоединились', async () => {
      const onActivate = jest.fn();
      relay.setCallbacks({ onActivate, onIdleExpire: jest.fn() });

      const child = makeWs();
      const parent = makeWs();
      relay.attachProducer('s1', child as unknown as WsSocket);
      expect(onActivate).not.toHaveBeenCalled();

      relay.attachConsumer('s1', parent as unknown as WsSocket);
      // Promise.resolve() callback срабатывает на следующий tick
      await Promise.resolve();
      expect(onActivate).toHaveBeenCalledWith('s1');
    });

    it('onActivate срабатывает только один раз даже при reconnects', async () => {
      const onActivate = jest.fn();
      relay.setCallbacks({ onActivate, onIdleExpire: jest.fn() });

      relay.attachProducer('s1', makeWs() as unknown as WsSocket);
      relay.attachConsumer('s1', makeWs() as unknown as WsSocket);
      relay.attachConsumer('s1', makeWs() as unknown as WsSocket);
      await Promise.resolve();
      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('replace producer закрывает старого с code 4002', () => {
      const oldChild = makeWs();
      const newChild = makeWs();
      relay.attachProducer('s1', oldChild as unknown as WsSocket);
      relay.attachProducer('s1', newChild as unknown as WsSocket);
      expect(oldChild.closed).toEqual({ code: 4002, reason: 'replaced_by_new_producer' });
      expect(relay.snapshot('s1')?.producer).toBe(newChild);
    });
  });

  describe('publishFrame', () => {
    it('пересылает binary frame всем consumer-ам', () => {
      const child = makeWs();
      const parent1 = makeWs();
      const parent2 = makeWs();
      relay.attachProducer('s1', child as unknown as WsSocket);
      relay.attachConsumer('s1', parent1 as unknown as WsSocket);
      relay.attachConsumer('s1', parent2 as unknown as WsSocket);

      const frame = Buffer.from([1, 2, 3]);
      relay.publishFrame('s1', frame);

      expect(parent1.sent).toEqual([{ data: frame, binary: true }]);
      expect(parent2.sent).toEqual([{ data: frame, binary: true }]);
    });

    it('drop frame для consumer-а с bufferedAmount > 512KB', () => {
      const child = makeWs();
      const slow = makeWs(600 * 1024); // 600 KB
      relay.attachProducer('s1', child as unknown as WsSocket);
      relay.attachConsumer('s1', slow as unknown as WsSocket);

      relay.publishFrame('s1', Buffer.from([1]));
      expect(slow.sent).toHaveLength(0);
      expect(relay.snapshot('s1')?.dropCount).toBe(1);
    });

    it('terminate consumer с close 4004 при bufferedAmount > 2MB', () => {
      const child = makeWs();
      const overloaded = makeWs(3 * 1024 * 1024); // 3 MB
      relay.attachProducer('s1', child as unknown as WsSocket);
      relay.attachConsumer('s1', overloaded as unknown as WsSocket);

      relay.publishFrame('s1', Buffer.from([1]));
      expect(overloaded.closed).toEqual({ code: 4004, reason: 'backpressure_overflow' });
      expect(relay.snapshot('s1')?.consumers.size).toBe(0);
    });

    it('lastFrameTs обновляется на каждом publish', () => {
      const child = makeWs();
      const parent = makeWs();
      relay.attachProducer('s1', child as unknown as WsSocket);
      relay.attachConsumer('s1', parent as unknown as WsSocket);

      const t0 = relay.snapshot('s1')!.lastFrameTs;
      jest.useFakeTimers();
      jest.advanceTimersByTime(50);
      relay.publishFrame('s1', Buffer.from([1]));
      const t1 = relay.snapshot('s1')!.lastFrameTs;
      expect(t1).toBeGreaterThanOrEqual(t0 + 50);
      jest.useRealTimers();
    });
  });

  describe('detach', () => {
    it('уход producer-а закрывает всех consumer-ов с code 4003', () => {
      const child = makeWs();
      const parent = makeWs();
      relay.attachProducer('s1', child as unknown as WsSocket);
      relay.attachConsumer('s1', parent as unknown as WsSocket);

      relay.detach('s1', child as unknown as WsSocket);
      expect(parent.closed).toEqual({ code: 4003, reason: 'producer_gone' });
      expect(relay.size()).toBe(0);
    });

    it('уход consumer-а оставляет сессию пока есть producer', () => {
      const child = makeWs();
      const parent = makeWs();
      relay.attachProducer('s1', child as unknown as WsSocket);
      relay.attachConsumer('s1', parent as unknown as WsSocket);

      relay.detach('s1', parent as unknown as WsSocket);
      expect(relay.snapshot('s1')?.producer).toBe(child);
      expect(relay.snapshot('s1')?.consumers.size).toBe(0);
    });
  });

  describe('findIdleSessions', () => {
    it('возвращает сессии где lastFrameTs старше threshold', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-24T10:00:00Z'));

      const child = makeWs();
      relay.attachProducer('s_idle', child as unknown as WsSocket);

      jest.advanceTimersByTime(120_000); // +2 минуты

      const child2 = makeWs();
      relay.attachProducer('s_fresh', child2 as unknown as WsSocket);

      const stuck = relay.findIdleSessions(90_000);
      expect(stuck).toEqual(['s_idle']);

      jest.useRealTimers();
    });
  });

  describe('terminate', () => {
    it('закрывает producer и consumers, удаляет из памяти', () => {
      const child = makeWs();
      const parent = makeWs();
      relay.attachProducer('s1', child as unknown as WsSocket);
      relay.attachConsumer('s1', parent as unknown as WsSocket);

      relay.terminate('s1', 4008, 'session_ended');
      expect(child.closed?.code).toBe(4008);
      expect(parent.closed?.code).toBe(4008);
      expect(relay.size()).toBe(0);
    });

    it('no-op если сессии нет', () => {
      expect(() => relay.terminate('missing', 4008, 'x')).not.toThrow();
    });
  });
});
