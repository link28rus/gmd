import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ParentLocationController } from './parent-location.controller';
import { ParentLocationService } from './parent-location.service';
import { ParentLocationAuthGuard } from './guards/parent-location-auth.guard';

/** v0.70.0: геолокация родителей; метки на карте отдаёт FamilyLocationsController. */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ParentLocationController],
  providers: [ParentLocationService, ParentLocationAuthGuard],
  exports: [ParentLocationService],
})
export class ParentLocationModule {}
