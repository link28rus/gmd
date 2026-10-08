import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { FcmModule } from '../fcm/fcm.module';
import { ParentLocationController } from './parent-location.controller';
import { ParentLocationService } from './parent-location.service';
import { ParentLocationAuthGuard } from './guards/parent-location-auth.guard';
import { FindPhoneService } from './find-phone.service';

/**
 * v0.70.0: геолокация родителей; метки на карте отдаёт FamilyLocationsController.
 * v0.73.0: «Найти телефон» (FindPhoneService).
 */
@Module({
  imports: [PrismaModule, AuthModule, FcmModule],
  controllers: [ParentLocationController],
  providers: [ParentLocationService, FindPhoneService, ParentLocationAuthGuard],
  exports: [ParentLocationService],
})
export class ParentLocationModule {}
