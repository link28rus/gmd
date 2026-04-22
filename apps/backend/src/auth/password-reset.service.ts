import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { EMAIL_VERIFICATION_CONFIG } from './email-verification.service';
import type { EmailVerificationConfig } from './email-verification.service';

export type ConsumeResetResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid_token' | 'token_expired' | 'token_consumed' };

/**
 * Flow «админ сбрасывает пароль юзеру» и «юзер забыл пароль»:
 *  1. Бэкенд генерит 32-байтовый токен, хранит SHA-256 и шлёт письмо с
 *     ссылкой `{WEB_BASE_URL}/reset-password?token=…`.
 *  2. Страница собирает новый пароль и вызывает POST /auth/reset-password.
 *  3. Сервис потребляет токен, обновляет passwordHash и отзывает все
 *     активные refresh-токены юзера (чтобы прежние сессии перестали жить).
 *
 * Конфиг `EMAIL_VERIFICATION_CONFIG` переиспользуется — он уже держит
 * `webBaseUrl`; TTL ссылки сброса пароля зафиксирован на 1 час (короче,
 * чем у verify-email, т.к. это чувствительный путь).
 */
@Injectable()
export class PasswordResetService {
  private static readonly TTL_SEC = 60 * 60;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailerService) private readonly mailer: MailerService,
    @Inject(EMAIL_VERIFICATION_CONFIG) private readonly cfg: EmailVerificationConfig,
  ) {}

  async issueAndSend(userId: string, email: string, displayName: string): Promise<void> {
    // Отзываем ранее выпущенные активные токены — действовать должен только
    // последний, чтобы ссылка из предыдущего письма не сработала после того,
    // как мы прислали новое.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + PasswordResetService.TTL_SEC * 1000);
    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    const url = `${this.cfg.webBaseUrl}/reset-password?token=${rawToken}`;
    const subject = 'Сброс пароля в GMD';
    const text =
      `Здравствуйте, ${displayName}!\n\n` +
      `Для вашего аккаунта в GMD был запрошен сброс пароля. Чтобы задать ` +
      `новый пароль, перейдите по ссылке:\n\n${url}\n\n` +
      `Ссылка действует 1 час. Если вы не запрашивали сброс — просто ` +
      `проигнорируйте это письмо, текущий пароль продолжит работать.`;
    const html =
      `<p>Здравствуйте, <strong>${escapeHtml(displayName)}</strong>!</p>` +
      `<p>Для вашего аккаунта в GMD был запрошен сброс пароля. ` +
      `Чтобы задать новый пароль, нажмите кнопку ниже:</p>` +
      `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 20px;` +
      `background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px;` +
      `font-weight:600">Задать новый пароль</a></p>` +
      `<p style="color:#64748b;font-size:13px">Если кнопка не работает, ` +
      `скопируйте ссылку в адресную строку:<br><code>${escapeHtml(url)}</code></p>` +
      `<p style="color:#94a3b8;font-size:12px">Ссылка действует 1 час. Если вы не ` +
      `запрашивали сброс — просто проигнорируйте письмо.</p>`;

    await this.mailer.send({ to: email, subject, text, html });
  }

  async consume(rawToken: string): Promise<ConsumeResetResult> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record) return { ok: false, reason: 'invalid_token' };
    if (record.consumedAt) return { ok: false, reason: 'token_consumed' };
    if (record.expiresAt < new Date()) return { ok: false, reason: 'token_expired' };

    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return { ok: true, userId: record.userId };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
