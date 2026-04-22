import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AuthService } from './auth.service';
import { RequestOtpSchema } from './dto/request-otp.dto';
import type { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpSchema } from './dto/verify-otp.dto';
import type { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshSchema } from './dto/refresh.dto';
import type { RefreshDto } from './dto/refresh.dto';
import { LogoutSchema } from './dto/logout.dto';
import type { LogoutDto } from './dto/logout.dto';
import { LoginPasswordSchema } from './dto/login-password.dto';
import type { LoginPasswordDto } from './dto/login-password.dto';
import { SetPasswordSchema } from './dto/set-password.dto';
import type { SetPasswordDto } from './dto/set-password.dto';
import { DevSetPasswordSchema } from './dto/dev-set-password.dto';
import type { DevSetPasswordDto } from './dto/dev-set-password.dto';
import { RegisterSchema } from './dto/register.dto';
import type { RegisterDto } from './dto/register.dto';
import { ConfirmEmailSchema } from './dto/confirm-email.dto';
import type { ConfirmEmailDto } from './dto/confirm-email.dto';
import { ResetPasswordSchema } from './dto/reset-password.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

function extractMeta(req: Request): { userAgent?: string; ipAddress?: string } {
  return {
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 3 } })
  @UsePipes(new ZodValidationPipe(RequestOtpSchema))
  async requestOtp(@Body() dto: RequestOtpDto): Promise<unknown> {
    // По UX-решению продукта: если пользователь не зарегистрирован,
    // явно сообщаем об этом и предлагаем регистрацию (а не молчим как в
    // enumeration-defence). Rate-limit (3/10 мин) ограничивает подбор email.
    const started = Date.now();
    const r = await this.auth.requestOtp(dto.email);
    const elapsed = Date.now() - started;
    if (elapsed < 200) await new Promise((res) => setTimeout(res, 200 - elapsed));
    if (!r.ok) {
      // 404 — «нет такой почты / не подтверждена / заблокирована»; frontend
      // по `code` решает, предлагать ли регистрацию, или попросить обратиться
      // к админу.
      const message =
        r.reason === 'user_not_found'
          ? 'User not found'
          : r.reason === 'account_blocked'
            ? 'Account is blocked'
            : 'Email is not confirmed';
      throw new NotFoundException({ code: r.reason, message });
    }
    return { expiresIn: 600 };
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  @UsePipes(new ZodValidationPipe(VerifyOtpSchema))
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request): Promise<unknown> {
    const r = await this.auth.verifyOtp(dto.email, dto.code, extractMeta(req));
    if (!r.ok) {
      throw new BadRequestException({
        code: r.reason,
        message: 'OTP verification failed',
      });
    }
    return r;
  }

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { ttl: 600_000, limit: 5 } })
  @UsePipes(new ZodValidationPipe(RegisterSchema))
  async register(@Body() dto: RegisterDto): Promise<{ ok: true }> {
    const r = await this.auth.register(dto);
    if (!r.ok) {
      throw new BadRequestException({
        code: r.reason,
        message:
          r.reason === 'email_taken_verified'
            ? 'Email is already registered'
            : 'Email already awaits confirmation',
      });
    }
    return { ok: true };
  }

  @Post('confirm-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 20 } })
  @UsePipes(new ZodValidationPipe(ConfirmEmailSchema))
  async confirmEmail(@Body() dto: ConfirmEmailDto, @Req() req: Request): Promise<unknown> {
    const r = await this.auth.confirmEmail(dto.token, extractMeta(req));
    if (!r.ok) {
      throw new BadRequestException({
        code: r.reason,
        message: 'Email confirmation failed',
      });
    }
    return r;
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  @UsePipes(new ZodValidationPipe(ResetPasswordSchema))
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    const r = await this.auth.resetPassword(dto.token, dto.password);
    if (!r.ok) {
      throw new BadRequestException({
        code: r.reason,
        message: 'Password reset failed',
      });
    }
    return { ok: true };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UsePipes(new ZodValidationPipe(RefreshSchema))
  async refresh(@Body() dto: RefreshDto, @Req() req: Request): Promise<unknown> {
    const r = await this.auth.refreshTokens(dto.refreshToken, extractMeta(req));
    if (!r.ok) {
      throw new UnauthorizedException({
        code: 'refresh_invalid',
        message: r.replay ? 'Refresh reuse detected' : 'Refresh token invalid',
      });
    }
    return r;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UsePipes(new ZodValidationPipe(LogoutSchema))
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('login-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @UsePipes(new ZodValidationPipe(LoginPasswordSchema))
  async loginPassword(@Body() dto: LoginPasswordDto, @Req() req: Request): Promise<unknown> {
    return this.auth.loginWithPassword(dto.email, dto.password, extractMeta(req));
  }

  @Post('set-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ZodValidationPipe(SetPasswordSchema))
  async setPwd(@Body() dto: SetPasswordDto, @Req() req: Request): Promise<void> {
    const userId = (req as Request & { user?: { userId: string } }).user?.userId;
    if (!userId) throw new UnauthorizedException();
    await this.auth.setPassword(userId, dto.password);
  }

  @Post('dev/set-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ZodValidationPipe(DevSetPasswordSchema))
  async devSetPwd(
    @Body() dto: DevSetPasswordDto,
    @Headers('x-auth-dev-secret') secret: string | undefined,
  ): Promise<void> {
    if (process.env.AUTH_DEV_MODE !== 'true') throw new NotFoundException();
    if (!secret || secret !== process.env.AUTH_DEV_SECRET) throw new NotFoundException();
    await this.auth.devSetPassword(dto.email, dto.password);
  }
}
