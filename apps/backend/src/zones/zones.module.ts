import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { ZoneDetectionService } from './zone-detection.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ZonesController],
  providers: [ZonesService, ZoneDetectionService],
  exports: [ZonesService, ZoneDetectionService],
})
export class ZonesModule {}
