import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { RegisterFcmTokenSchema } from './dto/register-fcm-token.dto';
import type { RegisterFcmTokenDto } from './dto/register-fcm-token.dto';
import { RegisterRustoreTokenSchema } from './dto/register-rustore-token.dto';
import type { RegisterRustoreTokenDto } from './dto/register-rustore-token.dto';
import { ParentDevicesService } from './parent-devices.service';

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; email: string; role: string };
}

@Controller('parents/devices')
@UseGuards(JwtAuthGuard)
export class ParentDevicesController {
  constructor(@Inject(ParentDevicesService) private readonly svc: ParentDevicesService) {}

  @Post('fcm-token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UsePipes(new ZodValidationPipe(RegisterFcmTokenSchema))
  async registerFcm(
    @Req() req: AuthedRequest,
    @Body() dto: RegisterFcmTokenDto,
  ): Promise<{ id: string }> {
    return this.svc.register(req.user.userId, dto);
  }

  @Delete('fcm-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async revokeFcm(@Req() req: AuthedRequest, @Body() dto: { fcmToken: string }): Promise<void> {
    if (!dto?.fcmToken) return;
    await this.svc.revoke(req.user.userId, dto.fcmToken);
  }

  // v0.51 RuStore Push (lesson #24): параллельный канал для не-GMS устройств
  // и для bypass MIUI Restricted Settings. См. RegisterRustoreTokenSchema.
  @Post('rustore-token')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UsePipes(new ZodValidationPipe(RegisterRustoreTokenSchema))
  async registerRustore(
    @Req() req: AuthedRequest,
    @Body() dto: RegisterRustoreTokenDto,
  ): Promise<{ id: string }> {
    return this.svc.registerRustore(req.user.userId, dto);
  }

  @Delete('rustore-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async revokeRustore(
    @Req() req: AuthedRequest,
    @Body() dto: { rustorePushToken: string },
  ): Promise<void> {
    if (!dto?.rustorePushToken) return;
    await this.svc.revokeRustore(req.user.userId, dto.rustorePushToken);
  }
}
