import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ZonesService } from './zones.service';
import { CreateZoneSchema } from './dto/create-zone.schema';
import type { CreateZoneDto } from './dto/create-zone.schema';
import { UpdateZoneSchema } from './dto/update-zone.schema';
import type { UpdateZoneDto } from './dto/update-zone.schema';
import { ZonesEventsQuerySchema } from './dto/zones-events-query.schema';
import type { ZonesEventsQuery } from './dto/zones-events-query.schema';
import { ZoneMyNotificationsSchema } from './dto/zone-notifications.schema';
import type { ZoneMyNotificationsDto } from './dto/zone-notifications.schema';

interface AuthedRequest extends Request {
  user: { userId: string; familyId?: string | null };
}

@Controller('zones')
@UseGuards(JwtAuthGuard)
export class ZonesController {
  constructor(@Inject(ZonesService) private readonly svc: ZonesService) {}

  /** v0.64.0: семья — из JWT, как в children.controller. */
  private familyId(req: AuthedRequest): string {
    const familyId = req.user.familyId;
    if (!familyId) {
      throw new NotFoundException({ code: 'family_not_found', message: 'User has no family' });
    }
    return familyId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async create(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateZoneSchema)) dto: CreateZoneDto,
  ) {
    const familyId = this.familyId(req);
    return this.svc.create(familyId, req.user.userId, dto);
  }

  @Get()
  async list(@Req() req: AuthedRequest) {
    const familyId = this.familyId(req);
    return this.svc.list(familyId, req.user.userId);
  }

  @Get('events')
  async events(
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(ZonesEventsQuerySchema)) q: ZonesEventsQuery,
  ) {
    const familyId = this.familyId(req);
    return this.svc.listEvents(familyId, q);
  }

  @Get(':id')
  async get(@Req() req: AuthedRequest, @Param('id') id: string) {
    const familyId = this.familyId(req);
    return this.svc.get(familyId, id, req.user.userId);
  }

  @Patch(':id')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateZoneSchema)) dto: UpdateZoneDto,
  ) {
    const familyId = this.familyId(req);
    return this.svc.update(familyId, id, dto, req.user.userId);
  }

  /** v0.65.0: личные настройки уведомлений текущего родителя по детям зоны. */
  @Put(':id/my-notifications')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async setMyNotifications(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ZoneMyNotificationsSchema)) body: ZoneMyNotificationsDto,
  ) {
    const familyId = this.familyId(req);
    return this.svc.setMyNotifications(familyId, req.user.userId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async softDelete(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    const familyId = this.familyId(req);
    await this.svc.softDelete(familyId, id);
  }
}
