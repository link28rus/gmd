import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { ChildRealtimeGateway } from './child-realtime.gateway';
import { ChildRealtimeService } from './child-realtime.service';

@Module({
  imports: [PrismaModule, ChildDeviceModule],
  providers: [ChildRealtimeService, ChildRealtimeGateway],
  exports: [ChildRealtimeService],
})
export class ChildRealtimeModule {}
