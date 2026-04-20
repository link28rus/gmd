import { Injectable, Logger } from '@nestjs/common';
import type { MailerService } from '../../mailer/mailer.service';
import type { OtpDeliveryProvider } from './otp-delivery.provider';

@Injectable()
export class SmtpOtpProvider implements OtpDeliveryProvider {
  private readonly logger = new Logger(SmtpOtpProvider.name);

  constructor(private readonly mailer: MailerService) {}

  async send(to: string, code: string): Promise<void> {
    if (process.env.OTP_LOG_DEV === 'true') {
      this.logger.warn(`DEV_OTP email=${to} code=${code}`);
    }
    await this.mailer.send({
      to,
      subject: 'Код входа в GMD',
      text: `Ваш код входа: ${code}\n\nКод действителен 10 минут. Если вы не пытались войти — проигнорируйте это письмо.`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#111">Код входа в GMD</h2>
          <p style="font-size:32px; letter-spacing:4px; font-weight:700; color:#111; margin:24px 0">${code}</p>
          <p style="color:#555">Код действителен 10 минут. Если вы не пытались войти — проигнорируйте это письмо.</p>
        </div>
      `,
    });
  }
}
