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
import { ChildAuthGuard } from '../child-device/guards/child-auth.guard';
import type { ChildAuthContext } from '../child-device/child-device.service';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AppControlService } from './app-control.service';
import { AppBlockingService } from './app-blocking.service';
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
  constructor(
    @Inject(AppControlService) private readonly svc: AppControlService,
    @Inject(AppBlockingService) private readonly blocking: AppBlockingService,
  ) {}

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

  // ─── Phase 6.2 (v0.39): App Blocking — child poll endpoints ────────────

  /**
   * Список effective-rules (HARDCODED + PARENT + SYSTEM_DEFAULT) для child.
   * Дёргается при старте app, по FCM SYNC_RULES, и раз в 6 ч fallback.
   * Throttle 60/час (≈ 1 раз в минуту с запасом на retry).
   */
  @Get('app-rules')
  @Throttle({ default: { ttl: 3600_000, limit: 60 } })
  async getAppRules(
    @Req() req: ChildRequest,
  ): Promise<{ rules: Array<{ packageName: string; mode: string; source: string }> }> {
    const rules = await this.blocking.listEffectiveRules(req.childDevice.deviceId);
    return { rules };
  }

  /**
   * Активная BlockSession для child. 200 + payload | 200 + null если нет.
   * (Не 204 — Dart-клиенту проще обрабатывать unified JSON ответ.)
   * Дёргается при старте app, по FCM BLOCK_APPS, и раз в 60 сек fallback poll.
   * Throttle 120/час (≈ 1 раз в 30 сек).
   */
  @Get('active-block')
  @Throttle({ default: { ttl: 3600_000, limit: 120 } })
  async getActiveBlock(
    @Req() req: ChildRequest,
  ): Promise<{ session: { sessionId: string; startedAt: string; endsAt: string } | null }> {
    const session = await this.blocking.getActiveSessionByDevice(req.childDevice.deviceId);
    if (!session) return { session: null };
    return {
      session: {
        sessionId: session.id,
        startedAt: session.startedAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
      },
    };
  }
}
