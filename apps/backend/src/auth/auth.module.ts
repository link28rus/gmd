import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService, AUTH_CONFIG } from './auth.service';
import { JwtService, JWT_CONFIG } from './jwt.service';
import { OtpService, OTP_CONFIG } from './otp.service';
import { RefreshTokenService, REFRESH_TOKEN_CONFIG } from './refresh-token.service';
import { SmtpOtpProvider } from './providers/smtp-otp.provider';
import { OTP_DELIVERY } from './providers/otp-delivery.provider';
import { PrismaModule } from '../prisma/prisma.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { StaleTokenService } from './stale-token.service';
import { PasswordService, PASSWORD_CONFIG } from './password.service';
import { RedisModule } from '../redis/redis.module';
import { MailerModule } from '../mailer/mailer.module';
import { EmailVerificationService, EMAIL_VERIFICATION_CONFIG } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';

function asNum(v: string | undefined, def: number): number {
  return v ? Number(v) : def;
}

@Module({
  imports: [PrismaModule, RedisModule, MailerModule],
  controllers: [AuthController],
  providers: [
    {
      provide: JWT_CONFIG,
      useFactory: () => ({
        privateKeyPath: process.env.JWT_PRIVATE_KEY_PATH!,
        publicKeyPath: process.env.JWT_PUBLIC_KEY_PATH!,
        accessTtlSec: asNum(process.env.ACCESS_TOKEN_TTL_SECONDS, 900),
      }),
    },
    {
      provide: OTP_CONFIG,
      useFactory: () => ({
        ttlSec: asNum(process.env.OTP_TTL_SECONDS, 600),
        maxAttempts: asNum(process.env.OTP_MAX_ATTEMPTS, 3),
      }),
    },
    {
      provide: REFRESH_TOKEN_CONFIG,
      // 60 дней (sliding): rotate() перевыпускает токен с expiresAt=now+ttl на
      // каждом /auth/refresh без абсолютного потолка, поэтому активный
      // пользователь остаётся залогинен без повторного ввода пароля. Если с
      // устройства не заходили дольше ttl — токен истекает → требуется вход.
      useFactory: () => ({
        ttlSec: asNum(process.env.REFRESH_TOKEN_TTL_SECONDS, 5184000),
      }),
    },
    {
      provide: AUTH_CONFIG,
      useFactory: () => ({
        privacyPolicyVersion: process.env.PRIVACY_POLICY_VERSION || '1.3',
      }),
    },
    {
      provide: PASSWORD_CONFIG,
      useFactory: () => ({
        lockAfter: asNum(process.env.PASSWORD_LOCK_AFTER, 5),
        lockTtlSec: asNum(process.env.PASSWORD_LOCK_TTL_SECONDS, 900),
      }),
    },
    { provide: OTP_DELIVERY, useClass: SmtpOtpProvider },
    {
      provide: EMAIL_VERIFICATION_CONFIG,
      useFactory: () => ({
        ttlSec: asNum(process.env.EMAIL_VERIFICATION_TTL_SECONDS, 86400),
        webBaseUrl: process.env.WEB_BASE_URL?.replace(/\/+$/, '') || 'https://periscop.pro',
      }),
    },
    SmtpOtpProvider,
    JwtService,
    OtpService,
    RefreshTokenService,
    AuthService,
    JwtAuthGuard,
    StaleTokenService,
    PasswordService,
    EmailVerificationService,
    PasswordResetService,
  ],
  exports: [JwtService, JwtAuthGuard, StaleTokenService, AuthService, PasswordResetService],
})
export class AuthModule {}
