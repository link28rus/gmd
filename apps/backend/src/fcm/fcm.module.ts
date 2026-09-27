import { Module } from '@nestjs/common';
import { FcmService } from './fcm.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildRealtimeModule } from '../child-realtime/child-realtime.module';

@Module({
  imports: [PrismaModule, ChildRealtimeModule],
  providers: [FcmService],
  exports: [FcmService],
})
export class FcmModule {}
