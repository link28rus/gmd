import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { AdminModule } from '../admin/admin.module';
import { FcmModule } from '../fcm/fcm.module';
import { ChildRealtimeModule } from '../child-realtime/child-realtime.module';
import { DiagService } from './diag.service';
import { ChildDiagController } from './child-diag.controller';
import { AdminDiagController } from './admin-diag.controller';

/** v0.60: журнал приложения ребёнка на сервере (docs/superpowers/specs/2026-09-29-child-diag-logs.md). */
@Module({
  imports: [
    AuthModule,
    PrismaModule,
    ChildDeviceModule,
    AdminModule,
    FcmModule,
    ChildRealtimeModule,
  ],
  controllers: [ChildDiagController, AdminDiagController],
  providers: [DiagService],
  exports: [DiagService],
})
export class DiagModule {}
