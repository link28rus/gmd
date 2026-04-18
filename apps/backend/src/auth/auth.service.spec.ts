/* eslint-disable @typescript-eslint/no-explicit-any */
import { AuthService } from './auth.service';
import type { OtpService } from './otp.service';
import type { RefreshTokenService } from './refresh-token.service';
import type { JwtService } from './jwt.service';
import { FakeOtpProvider } from './providers/fake-otp.provider';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  _users: any[];
  _families: any[];
  _memberships: any[];
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  family: {
    create: jest.Mock;
    findUnique: jest.Mock;
  };
  membership: {
    create: jest.Mock;
    findFirst: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrismaMock(): MockPrisma {
  const users: any[] = [];
  const families: any[] = [];
  const memberships: any[] = [];
  const api: MockPrisma = {
    _users: users,
    _families: families,
    _memberships: memberships,
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => u.email === where.email && !u.deletedAt) ?? null),
      ),
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `u-${users.length + 1}`,
          name: null,
          deletedAt: null,
          ...data,
        };
        users.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id);
        Object.assign(u, data);
        return Promise.resolve(u);
      }),
    },
    family: {
      create: jest.fn(({ data }: any) => {
        const row = { id: `fam-${families.length + 1}`, name: 'Моя семья', ...data };
        families.push(row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(families.find((f) => f.id === where.id) ?? null),
      ),
    },
    membership: {
      create: jest.fn(({ data }: any) => {
        const row = { id: `m-${memberships.length + 1}`, ...data };
        memberships.push(row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(memberships.find((m) => m.userId === where.userId) ?? null),
      ),
    },
    $transaction: jest.fn((fn: any) => fn(api)),
  };
  return api;
}

describe('AuthService.verifyOtp', () => {
  let otpSvc: OtpService;
  let rtSvc: RefreshTokenService;
  let jwt: JwtService;
  let delivery: FakeOtpProvider;

  beforeEach(() => {
    otpSvc = { verify: jest.fn(), generate: jest.fn() } as unknown as OtpService;
    rtSvc = {
      create: jest.fn().mockResolvedValue({ token: 'rt', id: 'rt-id' }),
    } as unknown as RefreshTokenService;
    jwt = {
      signAccessToken: jest.fn().mockResolvedValue('at'),
    } as unknown as JwtService;
    delivery = new FakeOtpProvider();
  });

  it('первая verify: создаёт User+Family+Membership, возвращает токены', async () => {
    const prisma = makePrismaMock();
    (otpSvc.verify as jest.Mock).mockResolvedValueOnce({ ok: true, otpId: 'otp-1' });
    const svc = new AuthService(prisma as unknown as PrismaService, otpSvc, rtSvc, jwt, delivery, {
      privacyPolicyVersion: '1.0',
    });

    const r = await svc.verifyOtp('a@b.com', '111111', {});

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessToken).toBe('at');
    expect(r.refreshToken).toBe('rt');
    expect(prisma._users.length).toBe(1);
    expect(prisma._users[0].email).toBe('a@b.com');
    expect(prisma._users[0].acceptedPrivacyPolicyVersion).toBe('1.0');
    expect(prisma._families.length).toBe(1);
    expect(prisma._memberships[0].role).toBe('owner');
  });

  it('повторная verify существующего user: не создаёт новых User/Family', async () => {
    const prisma = makePrismaMock();
    prisma._users.push({
      id: 'u-1',
      email: 'a@b.com',
      name: null,
      deletedAt: null,
      emailVerifiedAt: new Date(),
      acceptedPrivacyPolicyVersion: '1.0',
    });
    prisma._families.push({ id: 'f-1', name: 'Моя семья' });
    prisma._memberships.push({
      id: 'm-1',
      userId: 'u-1',
      familyId: 'f-1',
      role: 'owner',
    });
    (otpSvc.verify as jest.Mock).mockResolvedValueOnce({ ok: true, otpId: 'otp-1' });
    const svc = new AuthService(prisma as unknown as PrismaService, otpSvc, rtSvc, jwt, delivery, {
      privacyPolicyVersion: '1.0',
    });

    const r = await svc.verifyOtp('a@b.com', '111111', {});

    expect(r.ok).toBe(true);
    expect(prisma._users.length).toBe(1);
    expect(prisma._families.length).toBe(1);
  });

  it('invalid code → ok=false', async () => {
    const prisma = makePrismaMock();
    (otpSvc.verify as jest.Mock).mockResolvedValueOnce({
      ok: false,
      reason: 'invalid_code',
    });
    const svc = new AuthService(prisma as unknown as PrismaService, otpSvc, rtSvc, jwt, delivery, {
      privacyPolicyVersion: '1.0',
    });

    const r = await svc.verifyOtp('a@b.com', '000000', {});

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_code');
  });
});

describe('AuthService.requestOtp', () => {
  it('generate + delivery.send вызываются', async () => {
    const prisma = makePrismaMock();
    const otpSvc = {
      generate: jest.fn().mockResolvedValue({ code: '123456', otpId: 'o-1' }),
    } as unknown as OtpService;
    const rtSvc = {} as RefreshTokenService;
    const jwt = {} as JwtService;
    const delivery = new FakeOtpProvider();
    const svc = new AuthService(prisma as unknown as PrismaService, otpSvc, rtSvc, jwt, delivery, {
      privacyPolicyVersion: '1.0',
    });

    await svc.requestOtp('a@b.com');

    expect(otpSvc.generate).toHaveBeenCalledWith('a@b.com');
    expect(delivery.sent.length).toBe(1);
    expect(delivery.sent[0].code).toBe('123456');
  });
});
