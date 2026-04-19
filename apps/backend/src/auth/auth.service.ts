import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp.service';
import { RefreshTokenService } from './refresh-token.service';
import type { TokenMeta } from './refresh-token.service';
import { JwtService } from './jwt.service';
import { OTP_DELIVERY } from './providers/otp-delivery.provider';
import type { OtpDeliveryProvider } from './providers/otp-delivery.provider';
import { PasswordService } from './password.service';
import { LockedException } from '../common/exceptions/locked.exception';

export interface AuthServiceConfig {
  privacyPolicyVersion: string;
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export type LoginResult = {
  ok: true;
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string | null };
  family: { id: string; name: string };
};

export type VerifyOtpResult =
  | LoginResult
  | { ok: false; reason: 'invalid_code' | 'code_expired' | 'code_consumed' };

export type RefreshResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; replay?: boolean };

let DUMMY_HASH: string | null = null;

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(RefreshTokenService) private readonly refresh: RefreshTokenService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(OTP_DELIVERY) private readonly delivery: OtpDeliveryProvider,
    @Inject(AUTH_CONFIG) private readonly cfg: AuthServiceConfig,
    @Inject(PasswordService) private readonly password: PasswordService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Pre-compute DUMMY_HASH for timing-safe compare on missing users
    if (!DUMMY_HASH) {
      DUMMY_HASH = await this.password.hash(randomBytes(32).toString('hex'));
    }
  }

  async requestOtp(email: string): Promise<void> {
    const { code } = await this.otp.generate(email);
    await this.delivery.send(email, code);
  }

  async verifyOtp(email: string, code: string, meta: TokenMeta): Promise<VerifyOtpResult> {
    const v = await this.otp.verify(email, code);
    if (!v.ok) return { ok: false, reason: v.reason };

    const { user, family } = await this.ensureUserAndFamily(email);
    return this.issueTokens(user, family, meta);
  }

  async refreshTokens(oldRefresh: string, meta: TokenMeta): Promise<RefreshResult> {
    const r = await this.refresh.rotate(oldRefresh, meta);
    if (!r.ok) return { ok: false, replay: r.replay };

    const [userRow, membership] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: r.userId }, select: { email: true } }),
      this.prisma.membership.findFirst({
        where: { userId: r.userId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!membership || !userRow) return { ok: false };
    const accessToken = await this.jwt.signAccessToken({
      sub: r.userId,
      email: userRow.email,
      familyId: membership.familyId,
      role: membership.role as 'owner' | 'parent',
    });
    return { ok: true, accessToken, refreshToken: r.token };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refresh.revoke(refreshToken);
  }

  async loginWithPassword(email: string, password: string, meta: TokenMeta): Promise<LoginResult> {
    const normalizedEmail = email.toLowerCase().trim();

    const lock = await this.password.isLocked(normalizedEmail);
    if (lock.locked) throw new LockedException('Account temporarily locked', lock.retryAfterSec);

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { memberships: { include: { family: true } } },
    });

    const hashToVerify = user?.passwordHash ?? DUMMY_HASH!;
    const ok = user?.passwordHash ? await this.password.verify(hashToVerify, password) : false;

    if (!ok || !user || user.deletedAt) {
      await this.password.recordFailure(normalizedEmail);
      await new Promise((r) => setTimeout(r, 150));
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    await this.password.clearFailures(normalizedEmail);

    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid email or password',
      });
    }

    return this.issueTokens(
      { id: user.id, email: user.email, name: user.name },
      { id: membership.family.id, name: membership.family.name },
      meta,
    );
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const h = await this.password.hash(password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: h } });
  }

  async devSetPassword(email: string, password: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    const h = await this.password.hash(password);
    if (existing) {
      await this.prisma.user.update({ where: { id: existing.id }, data: { passwordHash: h } });
    } else {
      await this.ensureUserAndFamilyWithPassword(normalizedEmail, h);
    }
  }

  private async issueTokens(
    user: { id: string; email: string; name: string | null },
    family: { id: string; name: string },
    meta: TokenMeta,
  ): Promise<LoginResult> {
    const accessToken = await this.jwt.signAccessToken({
      sub: user.id,
      email: user.email,
      familyId: family.id,
      role: 'owner',
    });
    const { token: refreshToken } = await this.refresh.create(user.id, meta);
    return {
      ok: true,
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name },
      family: { id: family.id, name: family.name },
    };
  }

  private async ensureUserAndFamily(email: string): Promise<{
    user: { id: string; email: string; name: string | null };
    family: { id: string; name: string };
  }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && !existing.deletedAt) {
      let m = await this.prisma.membership.findFirst({
        where: { userId: existing.id },
        orderBy: { createdAt: 'asc' },
      });
      if (!m) {
        const newFamily = await this.prisma.family.create({ data: {} });
        m = await this.prisma.membership.create({
          data: { userId: existing.id, familyId: newFamily.id, role: 'owner' },
        });
      }
      const family = await this.prisma.family.findUnique({ where: { id: m.familyId } });
      const user = !existing.emailVerifiedAt
        ? await this.prisma.user.update({
            where: { id: existing.id },
            data: { emailVerifiedAt: new Date() },
          })
        : existing;
      return {
        user: { id: user.id, email: user.email, name: user.name },
        family: { id: family!.id, name: family!.name },
      };
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        acceptedPrivacyPolicyVersion: this.cfg.privacyPolicyVersion,
      },
    });
    const family = await this.prisma.family.create({ data: {} });
    await this.prisma.membership.create({
      data: { userId: user.id, familyId: family.id, role: 'owner' },
    });
    return {
      user: { id: user.id, email: user.email, name: user.name },
      family: { id: family.id, name: family.name },
    };
  }

  private async ensureUserAndFamilyWithPassword(
    email: string,
    passwordHash: string,
  ): Promise<void> {
    const user = await this.prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        acceptedPrivacyPolicyVersion: this.cfg.privacyPolicyVersion,
        passwordHash,
      },
    });
    const family = await this.prisma.family.create({ data: {} });
    await this.prisma.membership.create({
      data: { userId: user.id, familyId: family.id, role: 'owner' },
    });
  }
}
