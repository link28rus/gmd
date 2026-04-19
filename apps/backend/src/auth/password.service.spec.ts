import { PasswordService } from './password.service';
import type { RedisService } from '../redis/redis.service';

interface RedisMock {
  _store: Record<string, number>;
  incr: jest.Mock;
  expire: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
  ttl: jest.Mock;
}

function makeRedisMock(): RedisMock {
  const store: Record<string, number> = {};
  return {
    _store: store,
    incr: jest.fn(async (key: string) => {
      store[key] = (store[key] ?? 0) + 1;
      return store[key];
    }),
    expire: jest.fn(async () => {}),
    get: jest.fn(async (key: string) => (store[key] !== undefined ? String(store[key]) : null)),
    del: jest.fn(async (key: string) => {
      delete store[key];
    }),
    ttl: jest.fn(async () => 900),
  };
}

describe('PasswordService', () => {
  const cfg = { lockAfter: 5, lockTtlSec: 900 };

  it('hash → verify(hash, plain) === true', async () => {
    const redis = makeRedisMock();
    const svc = new PasswordService(redis as unknown as RedisService, cfg);
    const h = await svc.hash('mySecret123');
    expect(await svc.verify(h, 'mySecret123')).toBe(true);
  });

  it('verify(hash, wrong) === false', async () => {
    const redis = makeRedisMock();
    const svc = new PasswordService(redis as unknown as RedisService, cfg);
    const h = await svc.hash('mySecret123');
    expect(await svc.verify(h, 'wrongPassword')).toBe(false);
  });

  it('recordFailure increments counter', async () => {
    const redis = makeRedisMock();
    const svc = new PasswordService(redis as unknown as RedisService, cfg);
    await svc.recordFailure('test@x.com');
    await svc.recordFailure('test@x.com');
    expect(redis.incr).toHaveBeenCalledTimes(2);
    expect(redis._store['pwlock:test@x.com']).toBe(2);
  });

  it('TTL is set on first incr only', async () => {
    const redis = makeRedisMock();
    const svc = new PasswordService(redis as unknown as RedisService, cfg);
    await svc.recordFailure('ttl@x.com');
    expect(redis.expire).toHaveBeenCalledTimes(1);
    await svc.recordFailure('ttl@x.com');
    expect(redis.expire).toHaveBeenCalledTimes(1);
  });

  it('after N=5 recordFailure: isLocked.locked === true', async () => {
    const redis = makeRedisMock();
    const svc = new PasswordService(redis as unknown as RedisService, cfg);
    for (let i = 0; i < 5; i++) {
      await svc.recordFailure('lock@x.com');
    }
    const status = await svc.isLocked('lock@x.com');
    expect(status.locked).toBe(true);
    expect(status.retryAfterSec).toBeGreaterThan(0);
  });

  it('clearFailures resets the counter', async () => {
    const redis = makeRedisMock();
    const svc = new PasswordService(redis as unknown as RedisService, cfg);
    for (let i = 0; i < 5; i++) {
      await svc.recordFailure('clear@x.com');
    }
    await svc.clearFailures('clear@x.com');
    const status = await svc.isLocked('clear@x.com');
    expect(status.locked).toBe(false);
  });

  it('isLocked returns false when below threshold', async () => {
    const redis = makeRedisMock();
    const svc = new PasswordService(redis as unknown as RedisService, cfg);
    await svc.recordFailure('partial@x.com');
    await svc.recordFailure('partial@x.com');
    const status = await svc.isLocked('partial@x.com');
    expect(status.locked).toBe(false);
    expect(status.retryAfterSec).toBe(0);
  });
});
