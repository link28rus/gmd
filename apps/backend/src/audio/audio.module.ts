import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { ConsentModule } from '../consent/consent.module';
import { DeviceCommandsModule } from '../device-commands/device-commands.module';
import { AudioService } from './audio.service';
import { AudioEvents } from './audio.events';
import { ParentAudioController } from './parent-audio.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AppSettingsModule,
    ChildDeviceModule,
    ConsentModule,
    DeviceCommandsModule,
  ],
  controllers: [ParentAudioController],
  providers: [AudioService, AudioEvents],
  exports: [AudioService, AudioEvents],
})
export class AudioModule {}
