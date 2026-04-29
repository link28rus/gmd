import { Module } from '@nestjs/common';
import { SosController } from './sos.controller';
import { SosService } from './sos.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailerModule } from '../mailer/mailer.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { FcmModule } from '../fcm/fcm.module';
import { ParentDevicesModule } from '../parent-devices/parent-devices.module';

@Module({
  imports: [PrismaModule, MailerModule, ChildDeviceModule, FcmModule, ParentDevicesModule],
  controllers: [SosController],
  providers: [SosService],
  exports: [SosService],
})
export class SosModule {}
