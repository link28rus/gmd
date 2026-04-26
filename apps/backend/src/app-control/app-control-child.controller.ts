import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChildAuthGuard } from '../child-device/guards/child-auth.guard';
import type { ChildAuthContext } from '../child-device/child-device.service';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AppControlService } from './app-control.service';
import { InstalledAppsBodySchema, type InstalledAppsBody } from './dto/installed-apps.dto';
import { UsageReportBodySchema, type UsageReportBody } from './dto/usage-report.dto';
import { AppIconsBodySchema, type AppIconsBody } from './dto/app-icons.dto';

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

/**
 * Endpoints, которые дёргает mobile-child (InstalledAppsWorker, UsageStatsWorker).
 * Все защищены ChildAuthGuard (Bearer device-token).
 *
 * Throttle:
 *   - installed-apps: daily (worker раз в сутки) → лимит мягкий 5/час на случай retry
 *   - usage-reports: every 15 min → лимит 30/час (≈ 1 в 2 мин с запасом на retry)
 *   - app-icons: батч на onboarding'е, потом редко → лимит 20/час
 */
@Controller('child')
@UseGuards(ChildAuthGuard)
export class AppControlChildController {
  constructor(@Inject(AppControlService) private readonly svc: AppControlService) {}

  @Post('installed-apps')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 3600_000, limit: 5 } })
  async postInstalledApps(
    @Req() req: ChildRequest,
    @Body(new ZodValidationPipe(InstalledAppsBodySchema)) dto: InstalledAppsBody,
  ): Promise<{ missingIconSha256: string[] }> {
    return this.svc.upsertInstalledApps(req.childDevice.deviceId, dto);
  }

  @Post('app-icons')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 3600_000, limit: 20 } })
  async postAppIcons(
    @Body(new ZodValidationPipe(AppIconsBodySchema)) dto: AppIconsBody,
  ): Promise<{ uploaded: number; skipped: number }> {
    return this.svc.uploadAppIcons(dto);
  }

  @Post('usage-reports')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 3600_000, limit: 30 } })
  async postUsageReport(
    @Req() req: ChildRequest,
    @Body(new ZodValidationPipe(UsageReportBodySchema)) dto: UsageReportBody,
  ): Promise<void> {
    await this.svc.upsertUsageBuckets(req.childDevice.deviceId, dto);
  }
}
