import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { AppControlChildController } from './app-control-child.controller';
import { AppControlParentController } from './app-control-parent.controller';
import { AppIconsPublicController } from './app-icons-public.controller';
import { AppControlService } from './app-control.service';
import { CategoryResolver } from './category-resolver.service';

/**
 * Phase 6.1 (v0.38) — Screen-time reporting.
 * См. docs/superpowers/specs/2026-04-26-gmd-phase6-app-control.md
 *
 * Endpoints:
 *   Child (Bearer device-token):
 *     POST /child/installed-apps      — snapshot установленных apps
 *     POST /child/app-icons           — батч новых иконок
 *     POST /child/usage-reports       — часовые bucket'ы за дату
 *
 *   Parent (Bearer JWT):
 *     GET  /family/children/:id/app-control/installed-apps
 *     GET  /family/children/:id/app-control/usage?range=day|week&date=YYYY-MM-DD
 *
 *   Public:
 *     GET  /app-icons/:sha256          — content-addressable, immutable cache
 */
@Module({
  imports: [PrismaModule, AuthModule, ChildDeviceModule],
  controllers: [AppControlChildController, AppControlParentController, AppIconsPublicController],
  providers: [AppControlService, CategoryResolver],
  exports: [AppControlService, CategoryResolver],
})
export class AppControlModule {}
