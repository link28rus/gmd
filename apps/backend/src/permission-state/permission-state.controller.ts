import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChildAuthGuard } from '../child-device/guards/child-auth.guard';
import type { ChildAuthContext } from '../child-device/child-device.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { PermissionReportSchema } from './permission-state';
import type { PermissionReport } from './permission-state';
import { PermissionStateService } from './permission-state.service';

@Controller()
export class PermissionStateController {
  constructor(@Inject(PermissionStateService) private readonly service: PermissionStateService) {}

  @Post('child/permission-state')
  @UseGuards(ChildAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  report(
    @Req() req: Request & { childDevice: ChildAuthContext },
    @Body(new ZodValidationPipe(PermissionReportSchema)) dto: PermissionReport,
  ) {
    return this.service.report(
      req.childDevice.deviceId,
      req.headers['x-child-token'] as string,
      dto,
    );
  }

  @Get('family/children/:childId/permission-state')
  @UseGuards(JwtAuthGuard)
  get(@Req() req: Request & { user: { familyId: string } }, @Param('childId') childId: string) {
    return this.service.get(req.user.familyId, childId);
  }

  @Post('family/children/:childId/refresh-permission-state')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 4 } })
  refresh(@Req() req: Request & { user: { familyId: string } }, @Param('childId') childId: string) {
    return this.service.refresh(req.user.familyId, childId);
  }
}
