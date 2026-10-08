/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  LOCATION_UPDATED_TYPE,
  LocationWatchService,
  PUSH_THROTTLE_SEC,
  WATCH_TTL_SEC,
} from './location-watch.service';

/** Минимальный фейк ioredis: sorted set + SET NX EX, время — Date.now(). */
function fakeRedisClient() {
  const zsets = new Map<string, Map<string, number>>();
  const strings = new Map<string, number>(); // key → expiresAt ms
  const client: any = {
    zadd: jest.fn(async (key: string, score: number, member: string) => {
      const z = zsets.get(key) ?? new Map<string, number>();
      z.set(member, score);
      zsets.set(key, z);
      return 1;
    }),
    expire: jest.fn(async () => 1),
    zremrangebyscore: jest.fn(async (key: string, _min: string, max: number) => {
      const z = zsets.get(key);
      if (!z) return 0;
      for (const [m, score] of z) if (score <= max) z.delete(m);
      return 0;
    }),
    zrange: jest.fn(async (key: string) => [...(zsets.get(key)?.keys() ?? [])]),
    set: jest.fn(async (key: string, _v: string, _ex: string, sec: number, _nx: string) => {
      const exp = strings.get(key);
      if (exp !== undefined && exp > Date.now()) return null;
      strings.set(key, Date.now() + sec * 1000);
      return 'OK';
    }),
  };
  client.multi = () => {
    const ops: Array<() => Promise<unknown>> = [];
    const chain: any = {
      zadd: (...a: any[]) => (ops.push(() => client.zadd(...a)), chain),
      expire: (...a: any[]) => (ops.push(() => client.expire(...a)), chain),
      exec: async () => Promise.all(ops.map((op) => op())),
    };
    return chain;
  };
  return client;
}

function makeService(devices: any[]) {
  const client = fakeRedisClient();
  const redis: any = { getClient: () => client };
  const fcm: any = { sendHybridToToken: jest.fn().mockResolvedValue(true) };
  const parentDevices: any = {
    findActiveByFamilyId: jest.fn().mockResolvedValue(devices),
    clearTokenByExpired: jest.fn(),
    clearRustoreByExpired: jest.fn(),
  };
  const svc = new LocationWatchService(redis, fcm, parentDevices);
  return { svc, fcm, parentDevices, client };
}

const dev = (id: string, userId: string, fcmToken: string | null = `tok-${id}`) => ({
  id,
  userId,
  fcmToken,
  rustorePushToken: null,
  appVersion: '0.69.0',
});

describe('LocationWatchService', () => {
  afterEach(() => jest.useRealTimers());

  it('шлёт тихий push только устройствам смотрящего родителя', async () => {
    const { svc, fcm } = makeService([dev('a', 'mom'), dev('b', 'mom'), dev('c', 'dad')]);
    await svc.watch('c1', 'mom');

    await svc.notifyNewPoints('c1', 'f1');

    expect(fcm.sendHybridToToken).toHaveBeenCalledTimes(2);
    const args = fcm.sendHybridToToken.mock.calls.map((c: any[]) => c[0]);
    expect(args.map((a: any) => a.tokens.fcmToken).sort()).toEqual(['tok-a', 'tok-b']);
    expect(args[0]).toMatchObject({
      data: { type: LOCATION_UPDATED_TYPE, childId: 'c1' },
      priority: 'normal',
      collapseKey: 'loc-c1',
    });
    expect(args[0].notification).toBeUndefined();
  });

  it('никто не смотрит — push и запрос устройств не делаются', async () => {
    const { svc, fcm, parentDevices } = makeService([dev('a', 'mom')]);
    await svc.notifyNewPoints('c1', 'f1');
    expect(parentDevices.findActiveByFamilyId).not.toHaveBeenCalled();
    expect(fcm.sendHybridToToken).not.toHaveBeenCalled();
  });

  it('отметка протухает через WATCH_TTL_SEC без продления', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-08T10:00:00Z') });
    const { svc, fcm } = makeService([dev('a', 'mom')]);
    await svc.watch('c1', 'mom');

    jest.setSystemTime(Date.now() + (WATCH_TTL_SEC + 1) * 1000);
    await svc.notifyNewPoints('c1', 'f1');

    expect(fcm.sendHybridToToken).not.toHaveBeenCalled();
    expect(await svc.watchers('c1')).toEqual([]);
  });

  it('не чаще одного push на ребёнка за PUSH_THROTTLE_SEC', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-08T10:00:00Z') });
    const { svc, fcm } = makeService([dev('a', 'mom')]);
    await svc.watch('c1', 'mom');

    await svc.notifyNewPoints('c1', 'f1');
    await svc.notifyNewPoints('c1', 'f1');
    expect(fcm.sendHybridToToken).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + (PUSH_THROTTLE_SEC + 1) * 1000);
    await svc.notifyNewPoints('c1', 'f1');
    expect(fcm.sendHybridToToken).toHaveBeenCalledTimes(2);
  });

  it('v0.70.0: watchMany отмечает всех детей семьи разом', async () => {
    const { svc, fcm, client } = makeService([dev('a', 'mom')]);
    await svc.watchMany(['c1', 'c2'], 'mom');

    expect(await svc.watchers('c1')).toEqual(['mom']);
    expect(await svc.watchers('c2')).toEqual(['mom']);
    await svc.notifyNewPoints('c2', 'f1');
    expect(fcm.sendHybridToToken).toHaveBeenCalledTimes(1);

    client.zadd.mockClear();
    await svc.watchMany([], 'mom');
    expect(client.zadd).not.toHaveBeenCalled();
  });

  it('пропускает устройства без push-токена и не бросает при сбое', async () => {
    const { svc, fcm, parentDevices } = makeService([dev('a', 'mom', null)]);
    await svc.watch('c1', 'mom');
    await svc.notifyNewPoints('c1', 'f1');
    expect(fcm.sendHybridToToken).not.toHaveBeenCalled();

    parentDevices.findActiveByFamilyId.mockRejectedValue(new Error('db down'));
    jest.useFakeTimers({ now: Date.now() + (PUSH_THROTTLE_SEC + 1) * 1000 });
    await expect(svc.notifyNewPoints('c1', 'f1')).resolves.toBeUndefined();
  });
});
