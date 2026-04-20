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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { ZonesService } from './zones.service';
import { CreateZoneSchema } from './dto/create-zone.schema';
import type { CreateZoneDto } from './dto/create-zone.schema';
import { UpdateZoneSchema } from './dto/update-zone.schema';
import type { UpdateZoneDto } from './dto/update-zone.schema';
import { ZonesEventsQuerySchema } from './dto/zones-events-query.schema';
import type { ZonesEventsQuery } from './dto/zones-events-query.schema';

interface AuthedRequest extends Request {
  user: { userId: string };
}

@Controller('zones')
@UseGuards(JwtAuthGuard)
export class ZonesController {
  constructor(
    @Inject(ZonesService) private readonly svc: ZonesService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async resolveFamilyId(userId: string): Promise<string> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      select: { familyId: true },
    });
    if (!membership) {
      throw new NotFoundException({ code: 'family_not_found', message: 'User has no family' });
    }
    return membership.familyId;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async create(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateZoneSchema)) dto: CreateZoneDto,
  ) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.create(familyId, req.user.userId, dto);
  }

  @Get()
  async list(@Req() req: AuthedRequest) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.list(familyId);
  }

  @Get('events')
  async events(
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(ZonesEventsQuerySchema)) q: ZonesEventsQuery,
  ) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.listEvents(familyId, q);
  }

  @Get(':id')
  async get(@Req() req: AuthedRequest, @Param('id') id: string) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.get(familyId, id);
  }

  @Patch(':id')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateZoneSchema)) dto: UpdateZoneDto,
  ) {
    const familyId = await this.resolveFamilyId(req.user.userId);
    return this.svc.update(familyId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async softDelete(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    const familyId = await this.resolveFamilyId(req.user.userId);
    await this.svc.softDelete(familyId, id);
  }
}
