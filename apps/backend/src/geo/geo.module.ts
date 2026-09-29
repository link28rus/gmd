import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeoController } from './geo.controller';
import { GeoIpService } from './geoip.service';

@Module({
  imports: [AuthModule],
  controllers: [GeoController],
  providers: [GeoIpService],
  exports: [GeoIpService],
})
export class GeoModule {}
