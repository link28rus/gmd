import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

export const EMAIL_VERIFICATION_CONFIG = Symbol('EMAIL_VERIFICATION_CONFIG');

export interface EmailVerificationConfig {
  /** TTL ссылки подтверждения в секундах (по умолчанию 24 ч). */
  ttlSec: number;
  /** Публичный URL web-приложения (для ссылки в письме). */
  webBaseUrl: string;
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid_token' | 'token_expired' | 'token_consumed' };

@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailerService) private readonly mailer: MailerService,
    @Inject(EMAIL_VERIFICATION_CONFIG) private readonly cfg: EmailVerificationConfig,
  ) {}

  /**
   * Создаёт новый токен (отменяя предыдущие непотреблённые для этого юзера) и
   * отправляет письмо со ссылкой для подтверждения. Сырая версия токена
   * возвращается наружу только через email — в БД хранится sha256-хэш.
   */
  async issueAndSend(userId: string, email: string, fullName: string): Promise<void> {
    // Погашаем старые активные токены, чтобы действовала только последняя
    // ссылка (сценарий «зарегистрировался повторно — перезапустить таймер»).
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + this.cfg.ttlSec * 1000);
    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    const url = `${this.cfg.webBaseUrl}/confirm-email?token=${rawToken}`;
    const subject = 'Подтвердите регистрацию в Перископ';
    const text =
      `Здравствуйте, ${fullName}!\n\n` +
      `Чтобы завершить регистрацию в Перископ — сервисе родительского контроля ` +
      `и геолокации детей — подтвердите свой email по ссылке:\n\n${url}\n\n` +
      `Ссылка действует 24 часа. Если вы не регистрировались — просто ` +
      `проигнорируйте это письмо.`;
    const html =
      `<p>Здравствуйте, <strong>${escapeHtml(fullName)}</strong>!</p>` +
      `<p>Чтобы завершить регистрацию в Перископ — сервисе родительского контроля ` +
      `и геолокации детей — подтвердите свой email:</p>` +
      `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 20px;` +
      `background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px;` +
      `font-weight:600">Подтвердить email</a></p>` +
      `<p style="color:#64748b;font-size:13px">Если кнопка не работает, ` +
      `скопируйте ссылку в адресную строку:<br><code>${escapeHtml(url)}</code></p>` +
      `<p style="color:#94a3b8;font-size:12px">Ссылка действует 24 часа. ` +
      `Если вы не регистрировались — просто проигнорируйте это письмо.</p>`;

    await this.mailer.send({ to: email, subject, text, html });
  }

  /**
   * Проверяет токен и, если валиден, помечает его потреблённым. Вызывающий
   * код сам решает, что делать с `userId` (например, проставляет
   * `emailVerifiedAt` и выдаёт access/refresh-пару).
   */
  async consume(rawToken: string): Promise<ConsumeResult> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });
    if (!record) return { ok: false, reason: 'invalid_token' };
    if (record.consumedAt) return { ok: false, reason: 'token_consumed' };
    if (record.expiresAt < new Date()) return { ok: false, reason: 'token_expired' };

    await this.prisma.emailVerificationToken.update({
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
