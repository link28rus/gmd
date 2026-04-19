import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { ConsentModule } from '../consent/consent.module';
import { AuthModule } from '../auth/auth.module';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { LocationsReadController } from './locations-read.controller';
import { FamilyAccessGuard } from './guards/family-access.guard';

@Module({
  imports: [PrismaModule, ChildDeviceModule, ConsentModule, AuthModule],
  controllers: [LocationsController, LocationsReadController],
  providers: [LocationsService, FamilyAccessGuard],
})
export class LocationsModule {}
