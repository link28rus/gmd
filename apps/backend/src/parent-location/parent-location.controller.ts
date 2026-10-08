import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import {
  CreateParentLocationDeviceSchema,
  IngestParentLocationsSchema,
  MAX_PARENT_BATCH_SIZE,
  SetSharingSchema,
} from './dto/parent-location.dto';
import type {
  CreateParentLocationDeviceDto,
  IngestParentLocationsDto,
  SetSharingDto,
} from './dto/parent-location.dto';
import { ParentLocationAuthGuard } from './guards/parent-location-auth.guard';
import { ParentLocationService } from './parent-location.service';
import type { ParentIngestResult, ParentLocationAuthContext } from './parent-location.service';

interface AuthedRequest extends Request {
  user: { userId: string; familyId?: string | null };
}

interface ParentLocationRequest extends Request {
  parentLocation: ParentLocationAuthContext;
}

/** v0.70.0: геолокация родителя для общей карты семьи (см. spec 2026-10-08). */
@Controller('parent-location')
export class ParentLocationController {
  constructor(@Inject(ParentLocationService) private readonly svc: ParentLocationService) {}

  @Post('devices')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async createDevice(
    @Req() req: AuthedRequest,
    @Body() rawBody: unknown,
  ): Promise<{ deviceId: string; token: string }> {
    const dto = new ZodValidationPipe(CreateParentLocationDeviceSchema).transform(
      rawBody ?? {},
    ) as CreateParentLocationDeviceDto;
    return this.svc.createDevice(req.user.userId, dto);
  }

  @Delete('devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async revokeDevice(
    @Req() req: AuthedRequest,
    @Param('deviceId') deviceId: string,
  ): Promise<void> {
    await this.svc.revokeDevice(req.user.userId, deviceId);
  }

  @Post('points')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ParentLocationAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async ingest(
    @Req() req: ParentLocationRequest,
    @Body() rawBody: unknown,
  ): Promise<ParentIngestResult> {
    if (
      rawBody &&
      typeof rawBody === 'object' &&
      Array.isArray((rawBody as { points?: unknown[] }).points) &&
      (rawBody as { points: unknown[] }).points.length > MAX_PARENT_BATCH_SIZE
    ) {
      throw new HttpException(
        { code: 'batch_too_large', message: `Batch size exceeds ${MAX_PARENT_BATCH_SIZE}` },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const parsed = new ZodValidationPipe(IngestParentLocationsSchema).transform(
      rawBody,
    ) as IngestParentLocationsDto;
    return this.svc.ingestPoints(req.parentLocation, parsed.points);
  }

  @Get('sharing')
  @UseGuards(JwtAuthGuard)
  async getSharing(@Req() req: AuthedRequest): Promise<{ enabled: boolean }> {
    return this.svc.getSharing(req.user.userId);
  }

  @Put('sharing')
  @UseGuards(JwtAuthGuard)
  async setSharing(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(SetSharingSchema)) body: SetSharingDto,
  ): Promise<{ enabled: boolean }> {
    return this.svc.setSharing(req.user.userId, body.enabled);
  }
}
