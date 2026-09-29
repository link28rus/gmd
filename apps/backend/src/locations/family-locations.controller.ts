import { Controller, Get, Inject, NotFoundException, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LocationsService } from './locations.service';
import type { FamilyLatestPoint } from './locations.service';

interface AuthedRequest extends Request {
  user: { userId: string; familyId?: string | null };
}

/**
 * v0.64.0: точки всех детей семьи одним запросом (карта геозон в кабинете).
 * Семья — из JWT, отдельная проверка доступа к ребёнку не нужна.
 */
@Controller('family/locations')
@UseGuards(JwtAuthGuard)
export class FamilyLocationsController {
  constructor(@Inject(LocationsService) private readonly svc: LocationsService) {}

  @Get('latest')
  async latest(@Req() req: AuthedRequest): Promise<{ items: FamilyLatestPoint[] }> {
    const familyId = req.user.familyId;
    if (!familyId) {
      throw new NotFoundException({ code: 'family_not_found', message: 'User has no family' });
    }
    return { items: await this.svc.getLatestGoodForFamily(familyId) };
  }
}
