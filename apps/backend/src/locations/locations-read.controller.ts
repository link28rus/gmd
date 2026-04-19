import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ListLocationsQuerySchema } from './dto/list-locations.dto';
import type { ListLocationsQuery } from './dto/list-locations.dto';
import { FamilyAccessGuard } from './guards/family-access.guard';
import { LocationsService } from './locations.service';

@Controller('children/:id')
@UseGuards(JwtAuthGuard, FamilyAccessGuard)
export class LocationsReadController {
  constructor(@Inject(LocationsService) private readonly svc: LocationsService) {}

  @Get('location/latest')
  async latest(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const row = await this.svc.getLatest(id);
    if (!row) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    return row;
  }

  @Get('locations')
  @HttpCode(HttpStatus.OK)
  async list(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ListLocationsQuerySchema)) q: ListLocationsQuery,
  ): Promise<unknown> {
    return this.svc.list(id, q);
  }
}
