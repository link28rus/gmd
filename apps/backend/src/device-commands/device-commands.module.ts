import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { ConsentModule } from '../consent/consent.module';
import { FcmModule } from '../fcm/fcm.module';
import { DeviceCommandsService } from './device-commands.service';
import { ParentCommandsController } from './parent-commands.controller';
import { ChildCommandsController } from './child-commands.controller';

@Module({
  imports: [AuthModule, PrismaModule, ChildDeviceModule, ConsentModule, FcmModule],
  controllers: [ParentCommandsController, ChildCommandsController],
  providers: [DeviceCommandsService],
  exports: [DeviceCommandsService],
})
export class DeviceCommandsModule {}
