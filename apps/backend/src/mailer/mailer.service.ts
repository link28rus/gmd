import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppSettingsService, SETTINGS_KEYS } from '../app-settings/app-settings.service';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export interface MailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const CONFIG_CACHE_TTL_MS = 30_000;

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  private cached: { cfg: SmtpConfig; transporter: Transporter; expiresAt: number } | null = null;

  constructor(@Inject(AppSettingsService) private readonly settings: AppSettingsService) {}

  private async loadConfig(): Promise<SmtpConfig> {
    // Fallback = пустая/dev-конфигурация. Реальные значения сидятся в БД при
    // первом старте (onModuleInit AppSettingsService) и правятся из админки.
    const [host, portStr, user, pass, from] = await Promise.all([
      this.settings.getString(SETTINGS_KEYS.SMTP_HOST, process.env.SMTP_HOST ?? 'localhost'),
      this.settings.getString(SETTINGS_KEYS.SMTP_PORT, process.env.SMTP_PORT ?? '1025'),
      this.settings.getString(SETTINGS_KEYS.SMTP_USER, process.env.SMTP_USER ?? ''),
      this.settings.getString(SETTINGS_KEYS.SMTP_PASS, process.env.SMTP_PASS ?? ''),
      this.settings.getString(
        SETTINGS_KEYS.SMTP_FROM,
        process.env.SMTP_FROM ?? 'GMD <no-reply@gmd.local>',
      ),
    ]);
    const port = Number.parseInt(portStr, 10) || 587;
    return { host, port, user, pass, from };
  }

  private async getTransporter(): Promise<{ cfg: SmtpConfig; transporter: Transporter }> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now) {
      return { cfg: this.cached.cfg, transporter: this.cached.transporter };
    }
    const cfg = await this.loadConfig();
    const transporter = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
    this.cached = { cfg, transporter, expiresAt: now + CONFIG_CACHE_TTL_MS };
    return { cfg, transporter };
  }

  /**
   * Сбрасывает кэш транспортера — вызывается после изменения smtp.* настроек,
   * чтобы следующий send подтянул свежую конфигурацию.
   */
  invalidate(): void {
    this.cached = null;
  }

  async send(payload: MailPayload): Promise<void> {
    const { cfg, transporter } = await this.getTransporter();
    if (!cfg.host || cfg.host === 'localhost') {
      this.logger.warn(`SMTP not configured — skipping send to ${payload.to.slice(0, 3)}***`);
      return;
    }
    await transporter.sendMail({
      from: cfg.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
    this.logger.log(`Mail sent to ${payload.to.slice(0, 3)}*** subject="${payload.subject}"`);
  }

  /**
   * Явная тестовая отправка: всегда пытается отправить через текущий SMTP
   * (без проверки host==localhost), возвращает текст ошибки если не удалось.
   */
  async sendTest(
    to: string,
  ): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
    try {
      const { cfg, transporter } = await this.getTransporter();
      const info = await transporter.sendMail({
        from: cfg.from,
        to,
        subject: 'GMD — проверка SMTP',
        text: `Это тестовое письмо из админ-панели GMD.\n\nSMTP host: ${cfg.host}:${cfg.port}\nFrom: ${cfg.from}\n\nЕсли вы получили это письмо — конфигурация SMTP работает.`,
      });
      this.logger.log(`Test mail sent to ${to.slice(0, 3)}*** messageId=${info.messageId}`);
      return { ok: true, messageId: info.messageId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error';
      this.logger.warn(`Test mail to ${to.slice(0, 3)}*** failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
