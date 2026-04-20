import { Module } from '@nestjs/common';
import { MailerService, SMTP_CONFIG } from './mailer.service';

function asNum(v: string | undefined, def: number): number {
  return v ? Number(v) : def;
}

@Module({
  providers: [
    {
      provide: SMTP_CONFIG,
      useFactory: () => ({
        host: process.env.SMTP_HOST || 'localhost',
        port: asNum(process.env.SMTP_PORT, 1025),
        user: process.env.SMTP_USER || undefined,
        pass: process.env.SMTP_PASS || undefined,
        from: process.env.SMTP_FROM || 'GMD <no-reply@gmd.local>',
      }),
    },
    MailerService,
  ],
  exports: [MailerService, SMTP_CONFIG],
})
export class MailerModule {}
