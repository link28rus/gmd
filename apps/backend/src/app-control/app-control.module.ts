import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { FcmModule } from '../fcm/fcm.module';
import { AppControlChildController } from './app-control-child.controller';
import { AppControlParentController } from './app-control-parent.controller';
import { AppIconsPublicController } from './app-icons-public.controller';
import { AppControlService } from './app-control.service';
import { AppBlockingService } from './app-blocking.service';
import { ScheduleService } from './schedule.service';
import { CategoryResolver } from './category-resolver.service';

/**
 * Phase 6 — Родительский контроль.
 * См. docs/superpowers/specs/2026-04-26-gmd-phase6-app-control.md
 *
 * Endpoints:
 *   Child (Bearer device-token):
 *     POST /child/installed-apps      — snapshot установленных apps              (v0.38)
 *     POST /child/app-icons           — батч новых иконок                        (v0.38)
 *     POST /child/usage-reports       — часовые bucket'ы за дату                 (v0.38)
 *     GET  /child/app-rules           — effective whitelist + hardcoded         (v0.39)
 *     GET  /child/active-block        — активная BlockSession (или null)         (v0.39)
 *     GET  /child/schedules           — расписания автоблокировки                (v0.48)
 *
 *   Parent (Bearer JWT):
 *     GET    /family/children/:id/app-control/installed-apps                     (v0.38)
 *     GET    /family/children/:id/app-control/usage?range=day|week&date=…        (v0.38)
 *     GET    /family/children/:id/app-control/app-rules                          (v0.39)
 *     PUT    /family/children/:id/app-control/app-rules/:packageName             (v0.39)
 *     POST   /family/children/:id/app-control/block-sessions                     (v0.39)
 *     GET    /family/children/:id/app-control/block-sessions/active              (v0.39)
 *     DELETE /family/children/:id/app-control/block-sessions/:sessionId          (v0.39)
 *     GET    /family/children/:id/app-control/schedules                          (v0.48)
 *     POST   /family/children/:id/app-control/schedules                          (v0.48)
 *     PATCH  /family/children/:id/app-control/schedules/:scheduleId              (v0.48)
 *     DELETE /family/children/:id/app-control/schedules/:scheduleId              (v0.48)
 *
 *   Public:
 *     GET  /app-icons/:sha256          — content-addressable, immutable cache
 */
@Module({
  imports: [PrismaModule, AuthModule, ChildDeviceModule, FcmModule],
  controllers: [AppControlChildController, AppControlParentController, AppIconsPublicController],
  providers: [AppControlService, AppBlockingService, ScheduleService, CategoryResolver],
  exports: [AppControlService, AppBlockingService, ScheduleService, CategoryResolver],
})
export class AppControlModule {}
