import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common';
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
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ZodValidationPipe(RequestOtpSchema))
  async requestOtp(@Body() dto: RequestOtpDto): Promise<{ expiresIn: number }> {
    // Enumeration defense: всегда отвечаем 202 через мин. задержку.
    const started = Date.now();
    try {
      await this.auth.requestOtp(dto.email);
    } catch {
      // глушим реальную ошибку, чтобы timing был однотипным (enumeration defense)
    }
    const elapsed = Date.now() - started;
    if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
    return { expiresIn: 600 };
  }

  @Post('verify-otp')
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

  @Post('refresh')
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
  @UsePipes(new ZodValidationPipe(LogoutSchema))
  async logout(@Body() dto: LogoutDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }
}
