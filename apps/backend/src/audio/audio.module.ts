import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { ConsentModule } from '../consent/consent.module';
import { DeviceCommandsModule } from '../device-commands/device-commands.module';
import { AdminModule } from '../admin/admin.module';
import { AudioService } from './audio.service';
import { AudioRelay } from './audio.relay';
import { AudioTokenService } from './audio-token.service';
import { AudioGateway } from './audio.gateway';
import { ParentAudioController } from './parent-audio.controller';
import { ChildAudioController } from './child-audio.controller';
import { AudioAdminController } from './audio-admin.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AppSettingsModule,
    ChildDeviceModule,
    ConsentModule,
    DeviceCommandsModule,
    AdminModule,
  ],
  controllers: [ParentAudioController, ChildAudioController, AudioAdminController],
  providers: [AudioService, AudioRelay, AudioTokenService, AudioGateway],
  exports: [AudioService, AudioRelay],
})
export class AudioModule {}
