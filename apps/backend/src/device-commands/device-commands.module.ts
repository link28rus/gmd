import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { ConsentModule } from '../consent/consent.module';
import { DeviceCommandsService } from './device-commands.service';
import { ParentCommandsController } from './parent-commands.controller';
import { ChildCommandsController } from './child-commands.controller';

@Module({
  imports: [PrismaModule, ChildDeviceModule, ConsentModule],
  controllers: [ParentCommandsController, ChildCommandsController],
  providers: [DeviceCommandsService],
  exports: [DeviceCommandsService],
})
export class DeviceCommandsModule {}
