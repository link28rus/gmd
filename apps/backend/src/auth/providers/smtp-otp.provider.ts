import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { OtpDeliveryProvider } from './otp-delivery.provider';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

export const SMTP_CONFIG = Symbol('SMTP_CONFIG');

@Injectable()
export class SmtpOtpProvider implements OtpDeliveryProvider {
  private readonly logger = new Logger(SmtpOtpProvider.name);
  private readonly transporter: Transporter;

  constructor(@Inject(SMTP_CONFIG) private readonly cfg: SmtpConfig) {
    this.transporter = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }

  async send(to: string, code: string): Promise<void> {
    const subject = 'Код входа в GMD';
    const text = `Ваш код входа: ${code}\n\nКод действителен 10 минут. Если вы не пытались войти — проигнорируйте это письмо.`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#111">Код входа в GMD</h2>
        <p style="font-size:32px; letter-spacing:4px; font-weight:700; color:#111; margin:24px 0">${code}</p>
        <p style="color:#555">Код действителен 10 минут. Если вы не пытались войти — проигнорируйте это письмо.</p>
      </div>
    `;
    await this.transporter.sendMail({ from: this.cfg.from, to, subject, text, html });
    this.logger.log(`OTP email sent to ${to.slice(0, 3)}***`);
  }
}
