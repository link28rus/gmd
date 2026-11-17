import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { FcmModule } from '../fcm/fcm.module';
import { ParentDevicesModule } from '../parent-devices/parent-devices.module';
import { PermissionStateController } from './permission-state.controller';
import { PermissionStateService } from './permission-state.service';

@Module({
  imports: [PrismaModule, AuthModule, ChildDeviceModule, FcmModule, ParentDevicesModule],
  controllers: [PermissionStateController],
  providers: [PermissionStateService],
})
export class PermissionStateModule {}
