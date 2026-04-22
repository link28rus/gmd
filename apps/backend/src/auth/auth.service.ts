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
import { EmailVerificationService } from './email-verification.service';

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
  | {
      ok: false;
      reason: 'invalid_code' | 'code_expired' | 'code_consumed' | 'email_not_verified';
    };

export type RequestOtpResult =
  | { ok: true }
  | { ok: false; reason: 'user_not_found' | 'email_not_verified' };

export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: 'email_taken' | 'email_taken_verified' };

export type ConfirmEmailResult =
  | (LoginResult & { ok: true })
  | { ok: false; reason: 'invalid_token' | 'token_expired' | 'token_consumed' };

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
    @Inject(EmailVerificationService)
    private readonly emailVerification: EmailVerificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Pre-compute DUMMY_HASH for timing-safe compare on missing users
    if (!DUMMY_HASH) {
      DUMMY_HASH = await this.password.hash(randomBytes(32).toString('hex'));
    }
  }

  async requestOtp(email: string): Promise<RequestOtpResult> {
    const normalized = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, emailVerifiedAt: true, deletedAt: true },
    });
    if (!user || user.deletedAt) return { ok: false, reason: 'user_not_found' };
    if (!user.emailVerifiedAt) return { ok: false, reason: 'email_not_verified' };

    const { code } = await this.otp.generate(normalized);
    await this.delivery.send(normalized, code);
    return { ok: true };
  }

  async verifyOtp(email: string, code: string, meta: TokenMeta): Promise<VerifyOtpResult> {
    const normalized = email.toLowerCase().trim();
    const v = await this.otp.verify(normalized, code);
    if (!v.ok) return { ok: false, reason: v.reason };

    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
      include: { memberships: { include: { family: true } } },
    });
    if (!existing || existing.deletedAt) {
      return { ok: false, reason: 'invalid_code' };
    }
    if (!existing.emailVerifiedAt) {
      return { ok: false, reason: 'email_not_verified' };
    }
    const membership = existing.memberships[0];
    if (!membership) return { ok: false, reason: 'invalid_code' };

    return this.issueTokens(
      { id: existing.id, email: existing.email, name: existing.name },
      { id: membership.family.id, name: membership.family.name },
      meta,
    );
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

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException({
        code: 'email_not_verified',
        message: 'Email is not confirmed',
      });
    }

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

  /**
   * Регистрация по почте + паролю. Создаёт User (unverified), Family,
   * Membership (owner) в одной транзакции, затем отправляет письмо
   * подтверждения. Повторная регистрация с тем же email, пока он не
   * подтверждён, перезаписывает ФИО/пароль/семью и перевыпускает токен
   * подтверждения — чтобы таймер начинался заново.
   */
  async register(dto: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    middleName?: string;
    familyName?: string;
  }): Promise<RegisterResult> {
    const normalized = dto.email.toLowerCase().trim();
    const fullName = [dto.lastName, dto.firstName, dto.middleName]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join(' ');
    const familyName = dto.familyName?.trim() || dto.lastName.trim();
    const passwordHash = await this.password.hash(dto.password);

    const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (existing && !existing.deletedAt && existing.emailVerifiedAt) {
      return { ok: false, reason: 'email_taken_verified' };
    }

    let userId: string;
    if (existing && !existing.deletedAt) {
      // Пользователь зарегистрирован, но ещё не подтвердил email — разрешаем
      // обновить данные и перевыпустить ссылку (по UX: «регистрируюсь снова —
      // перезапустить таймер»).
      const updatedUser = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          middleName: dto.middleName ?? null,
          name: fullName,
          passwordHash,
          acceptedPrivacyPolicyVersion: this.cfg.privacyPolicyVersion,
        },
      });
      const membership = await this.prisma.membership.findFirst({
        where: { userId: updatedUser.id },
      });
      if (membership) {
        await this.prisma.family.update({
          where: { id: membership.familyId },
          data: { name: familyName },
        });
      } else {
        const family = await this.prisma.family.create({ data: { name: familyName } });
        await this.prisma.membership.create({
          data: { userId: updatedUser.id, familyId: family.id, role: 'owner' },
        });
      }
      userId = updatedUser.id;
    } else {
      const created = await this.prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: normalized,
            firstName: dto.firstName,
            lastName: dto.lastName,
            middleName: dto.middleName ?? null,
            name: fullName,
            passwordHash,
            acceptedPrivacyPolicyVersion: this.cfg.privacyPolicyVersion,
          },
        });
        const f = await tx.family.create({ data: { name: familyName } });
        await tx.membership.create({
          data: { userId: u.id, familyId: f.id, role: 'owner' },
        });
        return u;
      });
      userId = created.id;
    }

    await this.emailVerification.issueAndSend(userId, normalized, fullName);
    return { ok: true };
  }

  /**
   * Подтверждает email по одноразовому токену из письма. При успехе
   * проставляет `emailVerifiedAt` и сразу выдаёт access/refresh-пару —
   * пользователь попадает в кабинет без дополнительного шага «войдите».
   */
  async confirmEmail(rawToken: string, meta: TokenMeta): Promise<ConfirmEmailResult> {
    const r = await this.emailVerification.consume(rawToken);
    if (!r.ok) return { ok: false, reason: r.reason };

    const user = await this.prisma.user.findUnique({
      where: { id: r.userId },
      include: { memberships: { include: { family: true } } },
    });
    if (!user || user.deletedAt) return { ok: false, reason: 'invalid_token' };

    if (!user.emailVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }

    const membership = user.memberships[0];
    if (!membership) return { ok: false, reason: 'invalid_token' };

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
