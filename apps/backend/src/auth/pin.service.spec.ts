import { PinService } from './pin.service';
import type { RedisService } from '../redis/redis.service';

interface RedisMock {
  _store: Record<string, string>;
  incr: jest.Mock;
  expire: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  ttl: jest.Mock;
}

function makeRedisMock(): RedisMock {
  const store: Record<string, string> = {};
  return {
    _store: store,
    incr: jest.fn(async (key: string) => {
      const n = Number(store[key] ?? 0) + 1;
      store[key] = String(n);
      return n;
    }),
    expire: jest.fn(async () => {}),
    get: jest.fn(async (key: string) => store[key] ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    del: jest.fn(async (key: string) => {
      delete store[key];
    }),
    ttl: jest.fn(async () => 900),
  };
}

describe('PinService', () => {
  const cfg = { lockAfter: 5, lockTtlSec: 900, verifyTtlSec: 300 };

  it('hash → verify(hash, plain) === true', async () => {
    const redis = makeRedisMock();
    const svc = new PinService(redis as unknown as RedisService, cfg);
    const h = await svc.hash('1234');
    expect(await svc.verify(h, '1234')).toBe(true);
  });

  it('verify(hash, wrong) === false', async () => {
    const redis = makeRedisMock();
    const svc = new PinService(redis as unknown as RedisService, cfg);
    const h = await svc.hash('1234');
    expect(await svc.verify(h, '9999')).toBe(false);
  });

  it('recordFailure increments and sets TTL on first call only', async () => {
    const redis = makeRedisMock();
    const svc = new PinService(redis as unknown as RedisService, cfg);
    await svc.recordFailure('user-1');
    expect(redis.expire).toHaveBeenCalledTimes(1);
    await svc.recordFailure('user-1');
    expect(redis.expire).toHaveBeenCalledTimes(1);
    expect(redis._store['pinlock:user-1']).toBe('2');
  });

  it('after 5 failures: isLocked.locked === true with retryAfterSec > 0', async () => {
    const redis = makeRedisMock();
    const svc = new PinService(redis as unknown as RedisService, cfg);
    for (let i = 0; i < 5; i++) await svc.recordFailure('user-lock');
    const s = await svc.isLocked('user-lock');
    expect(s.locked).toBe(true);
    expect(s.retryAfterSec).toBeGreaterThan(0);
  });

  it('clearFailures resets lock', async () => {
    const redis = makeRedisMock();
    const svc = new PinService(redis as unknown as RedisService, cfg);
    for (let i = 0; i < 5; i++) await svc.recordFailure('user-clear');
    await svc.clearFailures('user-clear');
    expect((await svc.isLocked('user-clear')).locked).toBe(false);
  });

  it('markVerified sets marker with TTL, isVerified returns true', async () => {
    const redis = makeRedisMock();
    const svc = new PinService(redis as unknown as RedisService, cfg);
    await svc.markVerified('user-v');
    expect(redis.set).toHaveBeenCalledWith('pinverify:user-v', '1', 300);
    expect(await svc.isVerified('user-v')).toBe(true);
  });

  it('clearVerified removes marker', async () => {
    const redis = makeRedisMock();
    const svc = new PinService(redis as unknown as RedisService, cfg);
    await svc.markVerified('user-v');
    await svc.clearVerified('user-v');
    expect(await svc.isVerified('user-v')).toBe(false);
  });

  it('isVerified returns false when no marker', async () => {
    const redis = makeRedisMock();
    const svc = new PinService(redis as unknown as RedisService, cfg);
    expect(await svc.isVerified('stranger')).toBe(false);
  });
});
