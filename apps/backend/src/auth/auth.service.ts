import type { OnModuleInit } from '@nestjs/common';
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
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
import { PasswordResetService } from './password-reset.service';
import { StaleTokenService } from './stale-token.service';

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
  | { ok: false; reason: 'user_not_found' | 'email_not_verified' | 'account_blocked' };

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_token' | 'token_expired' | 'token_consumed' };

export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: 'email_taken' | 'email_taken_verified' };

export type ConfirmEmailResult =
  | (LoginResult & { ok: true })
  | { ok: false; reason: 'invalid_token' | 'token_expired' | 'token_consumed' };

export type SetPasswordResult = { accessToken: string; refreshToken: string };

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
    @Inject(PasswordResetService)
    private readonly passwordReset: PasswordResetService,
    @Optional() @Inject(StaleTokenService) private readonly stale?: StaleTokenService,
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
      select: { id: true, emailVerifiedAt: true, deletedAt: true, blockedAt: true },
    });
    if (!user || user.deletedAt) return { ok: false, reason: 'user_not_found' };
    if (user.blockedAt) return { ok: false, reason: 'account_blocked' };
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
      include: { memberships: { include: { family: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!existing || existing.deletedAt) {
      return { ok: false, reason: 'invalid_code' };
    }
    if (existing.blockedAt) {
      return { ok: false, reason: 'email_not_verified' };
    }
    if (!existing.emailVerifiedAt) {
      return { ok: false, reason: 'email_not_verified' };
    }
    const membership = existing.memberships[0];
    if (!membership) return { ok: false, reason: 'invalid_code' };

    return this.issueTokens(
      { id: existing.id, email: existing.email, name: existing.name },
      { id: membership.family.id, name: membership.family.name, role: membership.role },
      meta,
    );
  }

  async refreshTokens(oldRefresh: string, meta: TokenMeta): Promise<RefreshResult> {
    const r = await this.refresh.rotate(oldRefresh, meta);
    if (!r.ok) return { ok: false, replay: r.replay };

    const [userRow, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: r.userId },
        select: { email: true, deletedAt: true, blockedAt: true },
      }),
      this.prisma.membership.findFirst({
        where: { userId: r.userId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!membership || !userRow) return { ok: false };
    // Заблокирован/удалён: админка отзывает refresh-токены, но и токен,
    // переживший отзыв (гонка с ротацией), пару не получает.
    if (userRow.deletedAt || userRow.blockedAt) {
      await this.refresh.revokeAllForUser(r.userId);
      return { ok: false };
    }
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
      include: { memberships: { include: { family: true }, orderBy: { createdAt: 'asc' } } },
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

    if (user.blockedAt) {
      throw new UnauthorizedException({
        code: 'account_blocked',
        message: 'Account is blocked',
      });
    }

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
      { id: membership.family.id, name: membership.family.name, role: membership.role },
      meta,
    );
  }

  /**
   * Регистрация по почте + паролю. Создаёт User (unverified), Family,
   * Membership (owner) в одной транзакции, затем отправляет письмо
   * подтверждения. Повторная регистрация с тем же email, пока он не
   * подтверждён, только перевыпускает ссылку подтверждения (таймер заново).
   * Пароль, ФИО и семью НЕ меняет: иначе посторонний занял бы email своим
   * паролем, а владелец, нажав новую ссылку, подтвердил бы аккаунт с чужим
   * паролем. Ответ клиенту тот же, что при первой регистрации; письмо уходит
   * на сам email — прочитает его только владелец.
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
    let mailName = fullName;
    if (existing && !existing.deletedAt) {
      // Не подтверждён — данные первой регистрации не трогаем, только
      // переотправляем письмо. Семью создаём, лишь если её нет (без членства
      // подтверждение не выдаст токены).
      const membership = await this.prisma.membership.findFirst({
        where: { userId: existing.id },
      });
      if (!membership) {
        const family = await this.prisma.family.create({ data: { name: familyName } });
        await this.prisma.membership.create({
          data: { userId: existing.id, familyId: family.id, role: 'owner' },
        });
      }
      userId = existing.id;
      mailName = existing.name || fullName;
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

    await this.emailVerification.issueAndSend(userId, normalized, mailName);
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
      include: { memberships: { include: { family: true }, orderBy: { createdAt: 'asc' } } },
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
      { id: membership.family.id, name: membership.family.name, role: membership.role },
      meta,
    );
  }

  /**
   * Установка/смена пароля из кабинета. Если пароль уже есть — нужен текущий
   * (украденный access-токен не даёт перехватить аккаунт). После смены
   * отзываются ВСЕ refresh-токены (по access-токену текущую сессию не
   * определить: в JWT нет id refresh-токена), access-токены помечаются
   * устаревшими, а вызывающему выдаётся новая пара — он остаётся в системе,
   * остальные сессии нет.
   */
  async setPassword(
    userId: string,
    password: string,
    currentPassword: string | undefined,
    meta: TokenMeta,
  ): Promise<SetPasswordResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { family: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!user || user.deletedAt || user.blockedAt) {
      throw new UnauthorizedException({ code: 'unauthorized', message: 'User not found' });
    }
    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException({ code: 'unauthorized', message: 'No family membership' });
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        throw new BadRequestException({
          code: 'current_password_required',
          message: 'Current password is required',
        });
      }
      // Тот же счётчик, что у входа по паролю: перебор текущего пароля
      // с чужим access-токеном упирается в блокировку.
      const lock = await this.password.isLocked(user.email);
      if (lock.locked) throw new LockedException('Account temporarily locked', lock.retryAfterSec);
      const ok = await this.password.verify(user.passwordHash, currentPassword);
      if (!ok) {
        await this.password.recordFailure(user.email);
        throw new BadRequestException({
          code: 'invalid_current_password',
          message: 'Current password is incorrect',
        });
      }
      await this.password.clearFailures(user.email);
    }

    const h = await this.password.hash(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash: h } }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    // Сначала отметка, потом новый токен: его iatMs не раньше отметки,
    // поэтому сам вызывающий token_stale не получит.
    await this.stale?.markStale([userId]);
    const tokens = await this.issueTokens(
      { id: user.id, email: user.email, name: user.name },
      { id: membership.family.id, name: membership.family.name, role: membership.role },
      meta,
    );
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
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
    family: { id: string; name: string; role: 'owner' | 'parent' },
    meta: TokenMeta,
  ): Promise<LoginResult> {
    const accessToken = await this.jwt.signAccessToken({
      sub: user.id,
      email: user.email,
      familyId: family.id,
      role: family.role,
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

  /**
   * Завершает цикл «админ инициировал сброс пароля / пользователь забыл
   * пароль». Потребляет токен из письма, обновляет hash и отзывает все
   * активные refresh-токены — чтобы прежние сессии перестали работать.
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<ResetPasswordResult> {
    const r = await this.passwordReset.consume(rawToken);
    if (!r.ok) return { ok: false, reason: r.reason };

    const user = await this.prisma.user.findUnique({
      where: { id: r.userId },
      select: { id: true, deletedAt: true },
    });
    if (!user || user.deletedAt) return { ok: false, reason: 'invalid_token' };

    const hash = await this.password.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.password.clearFailures(
      (await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { email: true },
      }))!.email,
    );
    return { ok: true };
  }

  /**
   * Обновляет `lastSeenAt` у пользователя, вызывается heartbeat'ом из
   * кабинета. Throttled на уровне контроллера (раз в минуту на JWT), чтобы
   * не писать в БД на каждый рендер страницы.
   */
  async touchLastSeen(userId: string): Promise<void> {
    await this.prisma.user
      .update({
        where: { id: userId },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => {
        /* юзер мог быть удалён между JWT-проверкой и апдейтом — игнор */
      });
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
