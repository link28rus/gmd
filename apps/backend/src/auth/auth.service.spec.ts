/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { OtpService } from './otp.service';
import type { RefreshTokenService } from './refresh-token.service';
import type { JwtService } from './jwt.service';
import { FakeOtpProvider } from './providers/fake-otp.provider';
import type { PrismaService } from '../prisma/prisma.service';
import type { PasswordService } from './password.service';
import type { EmailVerificationService } from './email-verification.service';
import type { PasswordResetService } from './password-reset.service';
import type { StaleTokenService } from './stale-token.service';
import { LockedException } from '../common/exceptions/locked.exception';

function makeEmailVerificationMock(): jest.Mocked<EmailVerificationService> {
  return {
    issueAndSend: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue({ ok: false, reason: 'invalid_token' as const }),
  } as unknown as jest.Mocked<EmailVerificationService>;
}

function makePasswordResetMock(): jest.Mocked<PasswordResetService> {
  return {
    issueAndSend: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue({ ok: false, reason: 'invalid_token' as const }),
  } as unknown as jest.Mocked<PasswordResetService>;
}

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

function makePasswordMock(): jest.Mocked<PasswordService> {
  return {
    hash: jest.fn().mockResolvedValue('hashed'),
    verify: jest.fn().mockResolvedValue(true),
    recordFailure: jest.fn().mockResolvedValue({ locked: false, retryAfterSec: 0 }),
    isLocked: jest.fn().mockResolvedValue({ locked: false, retryAfterSec: 0 }),
    clearFailures: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<PasswordService>;
}

function makeService(
  prisma: MockPrisma,
  passwordMock?: jest.Mocked<PasswordService>,
  extra: {
    stale?: StaleTokenService;
    rtSvc?: RefreshTokenService;
    emailVerification?: jest.Mocked<EmailVerificationService>;
  } = {},
): AuthService {
  const otpSvc: OtpService = { verify: jest.fn(), generate: jest.fn() } as unknown as OtpService;
  const rtSvc: RefreshTokenService =
    extra.rtSvc ??
    ({
      create: jest.fn().mockResolvedValue({ token: 'rt', id: 'rt-id' }),
    } as unknown as RefreshTokenService);
  const jwt: JwtService = {
    signAccessToken: jest.fn().mockResolvedValue('at'),
  } as unknown as JwtService;
  const delivery = new FakeOtpProvider();
  const password = passwordMock ?? makePasswordMock();
  const emailVerification = extra.emailVerification ?? makeEmailVerificationMock();
  const passwordReset = makePasswordResetMock();
  const svc = new AuthService(
    prisma as unknown as PrismaService,
    otpSvc,
    rtSvc,
    jwt,
    delivery,
    { privacyPolicyVersion: '1.0' },
    password,
    emailVerification,
    passwordReset,
    extra.stale,
  );
  // Skip onModuleInit (DUMMY_HASH) for unit tests — password.hash is mocked
  return svc;
}

// ─── verifyOtp ────────────────────────────────────────────────────────────────

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

  it('verify для незарегистрированного email → invalid_code, не создаёт User/Family', async () => {
    // После перехода на регистрацию через /register, verifyOtp больше не
    // «стелется под пользователя» — если user'а нет в БД, возвращаем
    // invalid_code (OTP генерится только для зарегистрированных, значит
    // сюда может прийти только код от кого-то, кого уже удалили).
    const prisma = makePrismaMock();
    (otpSvc.verify as jest.Mock).mockResolvedValueOnce({ ok: true, otpId: 'otp-1' });
    const password = makePasswordMock();
    const svc = new AuthService(
      prisma as unknown as PrismaService,
      otpSvc,
      rtSvc,
      jwt,
      delivery,
      { privacyPolicyVersion: '1.0' },
      password,
      makeEmailVerificationMock(),
      makePasswordResetMock(),
    );

    const r = await svc.verifyOtp('a@b.com', '111111', {});

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_code');
    expect(prisma._users.length).toBe(0);
    expect(prisma._families.length).toBe(0);
  });

  it('повторная verify существующего подтверждённого user → токены', async () => {
    const prisma = makePrismaMock();
    const userRow = {
      id: 'u-1',
      email: 'a@b.com',
      name: null,
      deletedAt: null,
      emailVerifiedAt: new Date(),
      acceptedPrivacyPolicyVersion: '1.0',
      memberships: [
        {
          id: 'm-1',
          userId: 'u-1',
          familyId: 'f-1',
          role: 'owner',
          family: { id: 'f-1', name: 'Моя семья' },
        },
      ],
    };
    prisma._users.push(userRow);
    prisma._families.push({ id: 'f-1', name: 'Моя семья' });
    prisma._memberships.push({
      id: 'm-1',
      userId: 'u-1',
      familyId: 'f-1',
      role: 'owner',
    });
    prisma.user.findUnique = jest.fn(({ where }: any) => {
      const u = prisma._users.find((x: any) => x.email === where.email);
      return Promise.resolve(u ?? null);
    });
    (otpSvc.verify as jest.Mock).mockResolvedValueOnce({ ok: true, otpId: 'otp-1' });
    const password = makePasswordMock();
    const svc = new AuthService(
      prisma as unknown as PrismaService,
      otpSvc,
      rtSvc,
      jwt,
      delivery,
      { privacyPolicyVersion: '1.0' },
      password,
      makeEmailVerificationMock(),
      makePasswordResetMock(),
    );

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
    const password = makePasswordMock();
    const svc = new AuthService(
      prisma as unknown as PrismaService,
      otpSvc,
      rtSvc,
      jwt,
      delivery,
      { privacyPolicyVersion: '1.0' },
      password,
      makeEmailVerificationMock(),
      makePasswordResetMock(),
    );

    const r = await svc.verifyOtp('a@b.com', '000000', {});

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_code');
  });
});

describe('AuthService.requestOtp', () => {
  it('verified user → generate + delivery.send вызываются', async () => {
    const prisma = makePrismaMock();
    prisma._users.push({
      id: 'u-1',
      email: 'a@b.com',
      deletedAt: null,
      emailVerifiedAt: new Date(),
    });
    prisma.user.findUnique = jest.fn(({ where }: any) =>
      Promise.resolve(prisma._users.find((u: any) => u.email === where.email) ?? null),
    );
    const otpSvc = {
      generate: jest.fn().mockResolvedValue({ code: '123456', otpId: 'o-1' }),
    } as unknown as OtpService;
    const rtSvc = {} as RefreshTokenService;
    const jwt = {} as JwtService;
    const delivery = new FakeOtpProvider();
    const password = makePasswordMock();
    const svc = new AuthService(
      prisma as unknown as PrismaService,
      otpSvc,
      rtSvc,
      jwt,
      delivery,
      { privacyPolicyVersion: '1.0' },
      password,
      makeEmailVerificationMock(),
      makePasswordResetMock(),
    );

    const r = await svc.requestOtp('a@b.com');

    expect(r.ok).toBe(true);
    expect(otpSvc.generate).toHaveBeenCalledWith('a@b.com');
    expect(delivery.sent.length).toBe(1);
    expect(delivery.sent[0].code).toBe('123456');
  });

  it('незарегистрированный email → user_not_found, OTP не генерится', async () => {
    const prisma = makePrismaMock();
    const otpSvc = { generate: jest.fn() } as unknown as OtpService;
    const rtSvc = {} as RefreshTokenService;
    const jwt = {} as JwtService;
    const delivery = new FakeOtpProvider();
    const password = makePasswordMock();
    const svc = new AuthService(
      prisma as unknown as PrismaService,
      otpSvc,
      rtSvc,
      jwt,
      delivery,
      { privacyPolicyVersion: '1.0' },
      password,
      makeEmailVerificationMock(),
      makePasswordResetMock(),
    );

    const r = await svc.requestOtp('nobody@x.com');

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('user_not_found');
    expect(otpSvc.generate).not.toHaveBeenCalled();
    expect(delivery.sent.length).toBe(0);
  });

  it('email не подтверждён → email_not_verified, OTP не генерится', async () => {
    const prisma = makePrismaMock();
    prisma._users.push({
      id: 'u-1',
      email: 'pending@x.com',
      deletedAt: null,
      emailVerifiedAt: null,
    });
    prisma.user.findUnique = jest.fn(({ where }: any) =>
      Promise.resolve(prisma._users.find((u: any) => u.email === where.email) ?? null),
    );
    const otpSvc = { generate: jest.fn() } as unknown as OtpService;
    const rtSvc = {} as RefreshTokenService;
    const jwt = {} as JwtService;
    const delivery = new FakeOtpProvider();
    const password = makePasswordMock();
    const svc = new AuthService(
      prisma as unknown as PrismaService,
      otpSvc,
      rtSvc,
      jwt,
      delivery,
      { privacyPolicyVersion: '1.0' },
      password,
      makeEmailVerificationMock(),
      makePasswordResetMock(),
    );

    const r = await svc.requestOtp('pending@x.com');

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('email_not_verified');
    expect(otpSvc.generate).not.toHaveBeenCalled();
  });
});

// ─── loginWithPassword ────────────────────────────────────────────────────────

describe('AuthService.loginWithPassword', () => {
  function makeUserWithFamily(overrides: any = {}): { prisma: MockPrisma } {
    const prisma = makePrismaMock();
    prisma._users.push({
      id: 'u-1',
      email: 'user@x.com',
      name: 'Test',
      deletedAt: null,
      emailVerifiedAt: new Date(),
      passwordHash: 'stored-hash',
      acceptedPrivacyPolicyVersion: '1.0',
      memberships: [
        {
          id: 'm-1',
          userId: 'u-1',
          familyId: 'f-1',
          role: 'owner',
          family: { id: 'f-1', name: 'Моя семья' },
        },
      ],
      ...overrides,
    });
    // Make findUnique return full user with memberships for loginWithPassword
    prisma.user.findUnique = jest.fn(({ where }: any) => {
      const u = prisma._users.find((x: any) => x.email === where.email);
      return Promise.resolve(u ?? null);
    });
    return { prisma };
  }

  it('успех → возвращает accessToken + refreshToken', async () => {
    const { prisma } = makeUserWithFamily();
    const password = makePasswordMock();
    password.verify.mockResolvedValueOnce(true);
    const svc = makeService(prisma, password);

    const result = await svc.loginWithPassword('user@x.com', 'correct-pass', {});
    expect(result.ok).toBe(true);
    expect(result.accessToken).toBe('at');
    expect(result.refreshToken).toBe('rt');
  });

  it('email не найден → 401 + recordFailure', async () => {
    const prisma = makePrismaMock();
    const password = makePasswordMock();
    password.verify.mockResolvedValueOnce(false);
    const svc = makeService(prisma, password);

    await expect(svc.loginWithPassword('notfound@x.com', 'pass', {})).rejects.toThrow(
      UnauthorizedException,
    );
    expect(password.recordFailure).toHaveBeenCalledWith('notfound@x.com');
  });

  it('email найден без passwordHash → 401', async () => {
    const { prisma } = makeUserWithFamily({ passwordHash: null });
    const password = makePasswordMock();
    const svc = makeService(prisma, password);

    await expect(svc.loginWithPassword('user@x.com', 'pass', {})).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('пароль неверный → 401 + recordFailure', async () => {
    const { prisma } = makeUserWithFamily();
    const password = makePasswordMock();
    password.verify.mockResolvedValueOnce(false);
    const svc = makeService(prisma, password);

    await expect(svc.loginWithPassword('user@x.com', 'wrong-pass', {})).rejects.toThrow(
      UnauthorizedException,
    );
    expect(password.recordFailure).toHaveBeenCalled();
  });

  it('5-я неудача → 6-й вызов вызывает LockedException (isLocked.locked=true)', async () => {
    const { prisma } = makeUserWithFamily();
    const password = makePasswordMock();
    password.verify.mockResolvedValue(false);
    // simulate lock on 6th call
    password.isLocked.mockResolvedValueOnce({ locked: true, retryAfterSec: 900 });
    const svc = makeService(prisma, password);

    await expect(svc.loginWithPassword('user@x.com', 'wrong', {})).rejects.toThrow(LockedException);
  });

  it('успех сбрасывает counter (clearFailures)', async () => {
    const { prisma } = makeUserWithFamily();
    const password = makePasswordMock();
    password.verify.mockResolvedValueOnce(true);
    const svc = makeService(prisma, password);

    await svc.loginWithPassword('user@x.com', 'correct', {});
    expect(password.clearFailures).toHaveBeenCalledWith('user@x.com');
  });

  it('deletedAt != null → 401', async () => {
    const { prisma } = makeUserWithFamily({ deletedAt: new Date() });
    const password = makePasswordMock();
    password.verify.mockResolvedValueOnce(true);
    const svc = makeService(prisma, password);

    await expect(svc.loginWithPassword('user@x.com', 'pass', {})).rejects.toThrow(
      UnauthorizedException,
    );
  });

  describe('setPassword', () => {
    function setup(passwordHash: string | null) {
      const prisma = makePrismaMock();
      prisma._users.push({
        id: 'u-1',
        email: 'a@b.com',
        name: 'A',
        deletedAt: null,
        blockedAt: null,
        passwordHash,
        memberships: [{ role: 'owner', family: { id: 'f-1', name: 'Семья' } }],
      });
      prisma.user.findUnique = jest.fn(({ where }: any) =>
        Promise.resolve(prisma._users.find((u: any) => u.id === where.id) ?? null),
      );
      (prisma as any).refreshToken = { updateMany: jest.fn().mockResolvedValue({ count: 3 }) };
      prisma.$transaction = jest.fn((ops: any) =>
        typeof ops === 'function' ? ops(prisma) : Promise.all(ops),
      );
      const password = makePasswordMock();
      password.hash.mockResolvedValue('new-hash');
      const stale = { markStale: jest.fn().mockResolvedValue(undefined) };
      const svc = makeService(prisma, password, {
        stale: stale as unknown as StaleTokenService,
      });
      return { prisma, password, stale, svc };
    }

    it('без пароля (OTP-only): текущий не нужен, сессии отозваны, новая пара', async () => {
      const { prisma, password, stale, svc } = setup(null);
      const r = await svc.setPassword('u-1', 'newPassword', undefined, {});
      expect(password.verify).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { passwordHash: 'new-hash' },
      });
      expect((prisma as any).refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u-1', revokedAt: null } }),
      );
      expect(stale.markStale).toHaveBeenCalledWith(['u-1']);
      expect(r).toEqual({ accessToken: 'at', refreshToken: 'rt' });
    });

    it('пароль есть, текущий не передан → 400 current_password_required', async () => {
      const { prisma, svc } = setup('old-hash');
      await expect(svc.setPassword('u-1', 'newPassword', undefined, {})).rejects.toMatchObject({
        response: { code: 'current_password_required' },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('неверный текущий пароль → 400 invalid_current_password + recordFailure', async () => {
      const { prisma, password, stale, svc } = setup('old-hash');
      password.verify.mockResolvedValueOnce(false);
      await expect(svc.setPassword('u-1', 'newPassword', 'wrong', {})).rejects.toMatchObject({
        response: { code: 'invalid_current_password' },
      });
      expect(password.recordFailure).toHaveBeenCalledWith('a@b.com');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(stale.markStale).not.toHaveBeenCalled();
    });

    it('верный текущий пароль → hash обновлён', async () => {
      const { prisma, password, svc } = setup('old-hash');
      await svc.setPassword('u-1', 'newPassword', 'oldPassword', {});
      expect(password.verify).toHaveBeenCalledWith('old-hash', 'oldPassword');
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  it('devSetPassword создаёт юзера если не было', async () => {
    const prisma = makePrismaMock();
    const password = makePasswordMock();
    password.hash.mockResolvedValueOnce('dev-hash');
    const svc = makeService(prisma, password);

    await svc.devSetPassword('newdev@x.com', 'devpass');
    expect(prisma._users.length).toBe(1);
    expect(prisma._users[0].passwordHash).toBe('dev-hash');
    expect(prisma._users[0].email).toBe('newdev@x.com');
  });

  it('devSetPassword обновляет hash существующего', async () => {
    const prisma = makePrismaMock();
    prisma._users.push({ id: 'u-1', email: 'existing@x.com', deletedAt: null, passwordHash: null });
    prisma.user.findUnique = jest.fn(({ where }: any) =>
      Promise.resolve(prisma._users.find((u: any) => u.email === where.email) ?? null),
    );
    const password = makePasswordMock();
    password.hash.mockResolvedValueOnce('updated-hash');
    const svc = makeService(prisma, password);

    await svc.devSetPassword('existing@x.com', 'newpass');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { passwordHash: 'updated-hash' },
    });
  });
});

describe('AuthService.register (повтор на неподтверждённый email)', () => {
  it('не меняет пароль/ФИО, только переотправляет письмо', async () => {
    const prisma = makePrismaMock();
    prisma._users.push({
      id: 'u-1',
      email: 'v@x.com',
      name: 'Жертва Настоящая',
      firstName: 'Настоящая',
      lastName: 'Жертва',
      passwordHash: 'victim-hash',
      deletedAt: null,
      emailVerifiedAt: null,
    });
    prisma._memberships.push({ id: 'm-1', userId: 'u-1', familyId: 'fam-1', role: 'owner' });
    const emailVerification = makeEmailVerificationMock();
    const svc = makeService(prisma, undefined, { emailVerification });

    const r = await svc.register({
      email: 'V@x.com',
      password: 'attacker-pass',
      firstName: 'Злой',
      lastName: 'Хакер',
    });

    expect(r).toEqual({ ok: true });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma._users[0].passwordHash).toBe('victim-hash');
    expect(prisma.family.create).not.toHaveBeenCalled();
    expect(emailVerification.issueAndSend).toHaveBeenCalledWith(
      'u-1',
      'v@x.com',
      'Жертва Настоящая',
    );
  });
});

describe('AuthService.refreshTokens', () => {
  function setup(user: any) {
    const prisma = makePrismaMock();
    prisma.user.findUnique = jest.fn().mockResolvedValue(user);
    prisma.membership.findFirst = jest
      .fn()
      .mockResolvedValue({ userId: 'u-1', familyId: 'f-1', role: 'owner' });
    const rtSvc = {
      rotate: jest.fn().mockResolvedValue({ ok: true, token: 'rt2', userId: 'u-1' }),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    const svc = makeService(prisma, undefined, {
      rtSvc: rtSvc as unknown as RefreshTokenService,
    });
    return { svc, rtSvc };
  }

  it('активный пользователь → новая пара', async () => {
    const { svc } = setup({ email: 'a@b.com', deletedAt: null, blockedAt: null });
    expect(await svc.refreshTokens('rt1', {})).toEqual({
      ok: true,
      accessToken: 'at',
      refreshToken: 'rt2',
    });
  });

  it.each([
    ['заблокирован', { email: 'a@b.com', deletedAt: null, blockedAt: new Date() }],
    ['удалён', { email: 'a@b.com', deletedAt: new Date(), blockedAt: null }],
  ])('%s → ok:false и все refresh отозваны', async (_n, user) => {
    const { svc, rtSvc } = setup(user);
    expect(await svc.refreshTokens('rt1', {})).toEqual({ ok: false });
    expect(rtSvc.revokeAllForUser).toHaveBeenCalledWith('u-1');
  });
});
