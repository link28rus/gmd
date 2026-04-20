import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

export const SMTP_CONFIG = Symbol('SMTP_CONFIG');

export interface MailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transporter: Transporter;

  constructor(@Inject(SMTP_CONFIG) private readonly cfg: SmtpConfig) {
    this.transporter = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }

  async send(payload: MailPayload): Promise<void> {
    if (!this.cfg.host || this.cfg.host === 'localhost') {
      this.logger.warn(`SMTP not configured — skipping send to ${payload.to.slice(0, 3)}***`);
      return;
    }
    await this.transporter.sendMail({
      from: this.cfg.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
    this.logger.log(`Mail sent to ${payload.to.slice(0, 3)}*** subject="${payload.subject}"`);
  }
}
