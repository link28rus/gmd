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
import {
  AckSignalSchema,
  CreateParentLocationDeviceSchema,
  IngestParentLocationsSchema,
  MAX_PARENT_BATCH_SIZE,
  MyTrackQuerySchema,
  RenameDeviceSchema,
  SetSharingSchema,
} from './dto/parent-location.dto';
import type {
  AckSignalDto,
  CreateParentLocationDeviceDto,
  IngestParentLocationsDto,
  MyTrackQueryDto,
  RenameDeviceDto,
  SetSharingDto,
} from './dto/parent-location.dto';
import { FindPhoneService } from './find-phone.service';
import type { MyPhoneDto, MyTrackPointDto, SignalResult } from './find-phone.service';
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
  constructor(
    @Inject(ParentLocationService) private readonly svc: ParentLocationService,
    @Inject(FindPhoneService) private readonly findPhone: FindPhoneService,
  ) {}

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
    return this.svc.ingestPoints(req.parentLocation, parsed.points, parsed.device);
  }

  /** v0.73.0: телефон начал звонить по сигналу «Найти телефон». */
  @Post('signal/ack')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ParentLocationAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async ackSignal(
    @Req() req: ParentLocationRequest,
    @Body(new ZodValidationPipe(AckSignalSchema)) body: AckSignalDto,
  ): Promise<{ ok: true }> {
    return this.findPhone.ackSignal(req.parentLocation, body.signalId);
  }

  // ── v0.73.0 «Найти телефон»: свои телефоны; v0.74.0 — владелец семьи видит все ──

  @Get('my-devices')
  @UseGuards(JwtAuthGuard)
  async listMyPhones(@Req() req: AuthedRequest): Promise<{ items: MyPhoneDto[] }> {
    return { items: await this.findPhone.listMyPhones(req.user.userId) };
  }

  @Get('my-devices/:deviceId/track')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async getMyTrack(
    @Req() req: AuthedRequest,
    @Param('deviceId') deviceId: string,
    @Query(new ZodValidationPipe(MyTrackQuerySchema)) query: MyTrackQueryDto,
  ): Promise<{ items: MyTrackPointDto[] }> {
    return this.findPhone.getMyTrack(
      req.user.userId,
      deviceId,
      query.from,
      query.to,
      query.view ?? 'road',
    );
  }

  @Post('my-devices/:deviceId/signal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async requestSignal(
    @Req() req: AuthedRequest,
    @Param('deviceId') deviceId: string,
  ): Promise<SignalResult> {
    return this.findPhone.requestSignal(req.user.userId, deviceId);
  }

  @Patch('my-devices/:deviceId')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async renameDevice(
    @Req() req: AuthedRequest,
    @Param('deviceId') deviceId: string,
    @Body(new ZodValidationPipe(RenameDeviceSchema)) body: RenameDeviceDto,
  ): Promise<{ id: string; customName: string | null }> {
    return this.findPhone.renameDevice(req.user.userId, deviceId, body.name);
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
