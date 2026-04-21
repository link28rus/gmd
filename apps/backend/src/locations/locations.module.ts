import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { ConsentModule } from '../consent/consent.module';
import { AuthModule } from '../auth/auth.module';
import { ZonesModule } from '../zones/zones.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { LocationsService } from './locations.service';
import { TripsService } from './trips.service';
import { LocationsController } from './locations.controller';
import { LocationsReadController } from './locations-read.controller';
import { FamilyAccessGuard } from './guards/family-access.guard';

@Module({
  imports: [
    PrismaModule,
    ChildDeviceModule,
    ConsentModule,
    AuthModule,
    ZonesModule,
    AppSettingsModule,
  ],
  controllers: [LocationsController, LocationsReadController],
  providers: [LocationsService, TripsService, FamilyAccessGuard],
  exports: [TripsService],
})
export class LocationsModule {}
