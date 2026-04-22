import { BadRequestException, HttpException, UnauthorizedException } from '@nestjs/common';
import { UserPinService } from './user-pin.service';
import { PinService } from '../auth/pin.service';
import type { RedisService } from '../redis/redis.service';
import type { PrismaService } from '../prisma/prisma.service';

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

interface UserRow {
  id: string;
  pinHash: string | null;
  pinUpdatedAt: Date | null;
}
interface ChildRow {
  id: string;
  familyId: string;
  protectionEnabled: boolean;
  protectionEnabledAt: Date | null;
  protectionEnabledBy: string | null;
}

function makePrismaMock(init: {
  users: UserRow[];
  children?: ChildRow[];
  memberships?: Array<{ userId: string; familyId: string }>;
}): {
  prisma: PrismaService;
  state: {
    users: UserRow[];
    children: ChildRow[];
    memberships: Array<{ userId: string; familyId: string }>;
  };
} {
  const state = {
    users: init.users,
    children: init.children ?? [],
    memberships: init.memberships ?? [],
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return state.users.find((u) => u.id === where.id) ?? null;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
          const u = state.users.find((x) => x.id === where.id);
          if (!u) throw new Error('not found');
          Object.assign(u, data);
          return u;
        },
      ),
    },
    child: {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { familyId: { in: string[] }; protectionEnabled: boolean };
          data: Partial<ChildRow>;
        }) => {
          let count = 0;
          for (const c of state.children) {
            if (
              where.familyId.in.includes(c.familyId) &&
              c.protectionEnabled === where.protectionEnabled
            ) {
              Object.assign(c, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    membership: {
      findMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
        return state.memberships.filter((m) => m.userId === where.userId);
      }),
    },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
  };
  return { prisma: prisma as unknown as PrismaService, state };
}

describe('UserPinService', () => {
  const pinCfg = { lockAfter: 5, lockTtlSec: 900, verifyTtlSec: 300 };

  async function setupWithPin(plain: string) {
    const redis = makeRedisMock();
    const pin = new PinService(redis as unknown as RedisService, pinCfg);
    const hash = await pin.hash(plain);
    const { prisma, state } = makePrismaMock({
      users: [{ id: 'u1', pinHash: hash, pinUpdatedAt: new Date() }],
      memberships: [{ userId: 'u1', familyId: 'f1' }],
      children: [
        {
          id: 'c1',
          familyId: 'f1',
          protectionEnabled: true,
          protectionEnabledAt: new Date(),
          protectionEnabledBy: 'u1',
        },
      ],
    });
    const svc = new UserPinService(prisma, pin);
    return { svc, pin, redis, prisma, state };
  }

  async function setupWithoutPin() {
    const redis = makeRedisMock();
    const pin = new PinService(redis as unknown as RedisService, pinCfg);
    const { prisma, state } = makePrismaMock({
      users: [{ id: 'u1', pinHash: null, pinUpdatedAt: null }],
    });
    const svc = new UserPinService(prisma, pin);
    return { svc, pin, redis, prisma, state };
  }

  it('getStatus: returns isSet=false when pinHash is null', async () => {
    const { svc } = await setupWithoutPin();
    expect(await svc.getStatus('u1')).toEqual({ isSet: false, updatedAt: null });
  });

  it('getStatus: returns isSet=true when pinHash exists', async () => {
    const { svc } = await setupWithPin('1234');
    const s = await svc.getStatus('u1');
    expect(s.isSet).toBe(true);
    expect(s.updatedAt).toBeInstanceOf(Date);
  });

  it('getStatus: throws Unauthorized for unknown user', async () => {
    const { svc } = await setupWithoutPin();
    await expect(svc.getStatus('ghost')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('setPin: initial set without currentPin works', async () => {
    const { svc, state } = await setupWithoutPin();
    const res = await svc.setPin('u1', '4321');
    expect(res.isSet).toBe(true);
    expect(state.users[0].pinHash).toBeTruthy();
  });

  it('setPin: change requires currentPin when pin already set', async () => {
    const { svc } = await setupWithPin('1234');
    await expect(svc.setPin('u1', '5678')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setPin: change with correct currentPin updates hash and clears lock', async () => {
    const { svc, redis } = await setupWithPin('1234');
    redis._store['pinlock:u1'] = '3';
    redis._store['pinverify:u1'] = '1';
    const res = await svc.setPin('u1', '5678', '1234');
    expect(res.isSet).toBe(true);
    expect(redis._store['pinlock:u1']).toBeUndefined();
    expect(redis._store['pinverify:u1']).toBeUndefined();
  });

  it('setPin: wrong currentPin → 401 invalid_pin + counter incremented', async () => {
    const { svc, redis } = await setupWithPin('1234');
    await expect(svc.setPin('u1', '5678', '0000')).rejects.toBeInstanceOf(HttpException);
    expect(redis._store['pinlock:u1']).toBe('1');
  });

  it('verifyPin: correct PIN → marks verified', async () => {
    const { svc, pin } = await setupWithPin('1234');
    const r = await svc.verifyPin('u1', '1234');
    expect(r.ok).toBe(true);
    expect(await pin.isVerified('u1')).toBe(true);
  });

  it('verifyPin: no PIN set → 400 pin_not_set', async () => {
    const { svc } = await setupWithoutPin();
    await expect(svc.verifyPin('u1', '1234')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verifyPin: wrong → 401, 6-й подряд → 429', async () => {
    const { svc } = await setupWithPin('1234');
    for (let i = 0; i < 5; i++) {
      await expect(svc.verifyPin('u1', '9999')).rejects.toMatchObject({
        response: expect.objectContaining({ code: expect.any(String) }),
      });
    }
    await expect(svc.verifyPin('u1', '9999')).rejects.toMatchObject({
      status: 429,
    });
  });

  it('deletePin: correct currentPin → nullifies hash + disables protection for all family children', async () => {
    const { svc, state } = await setupWithPin('1234');
    await svc.deletePin('u1', '1234');
    expect(state.users[0].pinHash).toBeNull();
    expect(state.children[0].protectionEnabled).toBe(false);
    expect(state.children[0].protectionEnabledBy).toBeNull();
  });

  it('deletePin: wrong currentPin → 401', async () => {
    const { svc, state } = await setupWithPin('1234');
    await expect(svc.deletePin('u1', '0000')).rejects.toBeInstanceOf(HttpException);
    expect(state.users[0].pinHash).not.toBeNull();
  });
});
