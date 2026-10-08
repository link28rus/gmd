import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ParentLocationService } from '../parent-location/parent-location.service';
import type { FamilyParentPoint } from '../parent-location/parent-location.service';
import { LocationsService } from './locations.service';
import type { FamilyLatestPoint } from './locations.service';
import { LocationWatchService } from './location-watch.service';

interface AuthedRequest extends Request {
  user: { userId: string; familyId?: string | null };
}

function requireFamily(req: AuthedRequest): string {
  const familyId = req.user.familyId;
  if (!familyId) {
    throw new NotFoundException({ code: 'family_not_found', message: 'User has no family' });
  }
  return familyId;
}

/**
 * v0.64.0: точки всех детей семьи одним запросом (карта геозон в кабинете).
 * Семья — из JWT, отдельная проверка доступа к ребёнку не нужна.
 * v0.70.0: + метки родителей (`parents`) и отметка «смотрю» на всю семью.
 */
@Controller('family/locations')
@UseGuards(JwtAuthGuard)
export class FamilyLocationsController {
  constructor(
    @Inject(LocationsService) private readonly svc: LocationsService,
    @Inject(LocationWatchService) private readonly watch: LocationWatchService,
    @Inject(ParentLocationService) private readonly parentLocation: ParentLocationService,
  ) {}

  @Get('latest')
  async latest(
    @Req() req: AuthedRequest,
  ): Promise<{ items: FamilyLatestPoint[]; parents: FamilyParentPoint[] }> {
    const familyId = requireFamily(req);
    // `items` — прежний формат (старые клиенты читают только его).
    const [items, parents] = await Promise.all([
      this.svc.getLatestGoodForFamily(familyId),
      this.parentLocation.getLatestForFamily(familyId, req.user.userId),
    ]);
    return { items, parents };
  }

  // Общая карта на главном экране родителя: раз в 30 с продлевает отметку
  // «смотрю» на всех детей семьи (тот же механизм, что PUT
  // /children/:id/location/watch) — новые точки любого ребёнка приходят
  // тихим push LOCATION_UPDATED.
  @Put('watch')
  @HttpCode(HttpStatus.NO_CONTENT)
  async watchFamily(@Req() req: AuthedRequest): Promise<void> {
    const familyId = requireFamily(req);
    const childIds = await this.svc.activeChildIds(familyId);
    await this.watch.watchMany(childIds, req.user.userId);
  }
}
