import { Module } from '@nestjs/common';
import { RoadMatchService } from './road-match.service';

@Module({
  providers: [RoadMatchService],
  exports: [RoadMatchService],
})
export class RoadMatchModule {}
