import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChildDeviceService } from './child-device.service';
import type { ChildAuthContext } from './child-device.service';
import { ChildAuthGuard } from './guards/child-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ClaimSchema } from './dto/claim.dto';
import type { ClaimDto } from './dto/claim.dto';

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

@Controller('child')
export class ChildDeviceController {
  constructor(@Inject(ChildDeviceService) private readonly svc: ChildDeviceService) {}

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 600_000, limit: 10 } })
  async claim(
    @Req() req: Request,
    @Body(new ZodValidationPipe(ClaimSchema)) dto: ClaimDto,
  ): Promise<unknown> {
    const started = Date.now();
    const ua = req.headers['user-agent'];
    try {
      return await this.svc.claim(dto.code, {
        deviceName: dto.deviceName,
        osVersion: dto.osVersion,
        appVersion: dto.appVersion,
        consent14Plus: dto.consent14Plus,
        ip: req.ip,
        ua: typeof ua === 'string' ? ua : undefined,
      });
    } finally {
      const elapsed = Date.now() - started;
      if (elapsed < 200) await new Promise((r) => setTimeout(r, 200 - elapsed));
    }
  }

  @Get('me')
  @UseGuards(ChildAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async me(@Req() req: ChildRequest): Promise<unknown> {
    return {
      child: {
        id: req.childDevice.childId,
        name: req.childDevice.childName,
        familyId: req.childDevice.familyId,
      },
      device: { id: req.childDevice.deviceId },
    };
  }
}
