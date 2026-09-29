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
import { TrackQuerySchema } from './dto/track-query.dto';
import type { TrackQuery } from './dto/track-query.dto';
import { FamilyAccessGuard } from './guards/family-access.guard';
import { LocationsService } from './locations.service';
import { TripsService } from './trips.service';

@Controller('children/:id')
@UseGuards(JwtAuthGuard, FamilyAccessGuard)
export class LocationsReadController {
  constructor(
    @Inject(LocationsService) private readonly svc: LocationsService,
    @Inject(TripsService) private readonly trips: TripsService,
  ) {}

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

  // Очищенный трек активной (незакрытой) поездки. Если ребёнок сейчас
  // стоит на месте > TRIP_IDLE_MINUTES — active trip нет, массив пуст.
  // v0.63.0: без плохих точек (trackFlag), стоянки свёрнуты + stays[].
  @Get('trips/active-track')
  @HttpCode(HttpStatus.OK)
  async activeTrack(@Param('id') id: string): Promise<unknown> {
    return this.trips.getActiveTrack(id);
  }

  // v0.63.0: очищенный трек за период (карта дня в кабинете). Не больше 2 суток.
  @Get('track')
  @HttpCode(HttpStatus.OK)
  async track(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(TrackQuerySchema)) q: TrackQuery,
  ): Promise<unknown> {
    return this.trips.getTrack(id, new Date(q.from), new Date(q.to));
  }

  // Список поездок (history) за период. По умолчанию 30 дней.
  @Get('trips')
  @HttpCode(HttpStatus.OK)
  async listTrips(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<unknown> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const trips = await this.trips.listTrips(id, fromDate, toDate);
    return { trips };
  }

  // Очищенный трек конкретной поездки — для страницы истории.
  @Get('trips/:tripId/points')
  @HttpCode(HttpStatus.OK)
  async tripPoints(@Param('id') id: string, @Param('tripId') tripId: string): Promise<unknown> {
    return this.trips.getTripTrack(id, tripId);
  }
}
