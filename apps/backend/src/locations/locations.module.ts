import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildDeviceModule } from '../child-device/child-device.module';
import { ConsentModule } from '../consent/consent.module';
import { AuthModule } from '../auth/auth.module';
import { ZonesModule } from '../zones/zones.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { FcmModule } from '../fcm/fcm.module';
import { ParentDevicesModule } from '../parent-devices/parent-devices.module';
import { LocationsService } from './locations.service';
import { LocationWatchService } from './location-watch.service';
import { TripsService } from './trips.service';
import { TrackBackfillService } from './track-backfill.service';
import { LocationsController } from './locations.controller';
import { LocationsReadController } from './locations-read.controller';
import { FamilyLocationsController } from './family-locations.controller';
import { FamilyAccessGuard } from './guards/family-access.guard';

@Module({
  imports: [
    PrismaModule,
    ChildDeviceModule,
    ConsentModule,
    AuthModule,
    ZonesModule,
    AppSettingsModule,
    FcmModule,
    ParentDevicesModule,
  ],
  controllers: [LocationsController, LocationsReadController, FamilyLocationsController],
  providers: [
    LocationsService,
    LocationWatchService,
    TripsService,
    TrackBackfillService,
    FamilyAccessGuard,
  ],
  exports: [TripsService],
})
export class LocationsModule {}
