import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChildAuthGuard } from '../child-device/guards/child-auth.guard';
import type { ChildAuthContext } from '../child-device/child-device.service';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { IngestLocationsSchema, MAX_BATCH_SIZE } from './dto/ingest-locations.dto';
import type { IngestLocationsDto } from './dto/ingest-locations.dto';
import { LocationsService } from './locations.service';

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

@Controller('child')
export class LocationsController {
  constructor(@Inject(LocationsService) private readonly svc: LocationsService) {}

  @Post('locations')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ChildAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async ingest(@Req() req: ChildRequest, @Body() rawBody: unknown): Promise<unknown> {
    if (
      rawBody &&
      typeof rawBody === 'object' &&
      Array.isArray((rawBody as { points?: unknown[] }).points) &&
      (rawBody as { points: unknown[] }).points.length > MAX_BATCH_SIZE
    ) {
      throw new HttpException(
        { code: 'batch_too_large', message: `Batch size exceeds ${MAX_BATCH_SIZE}` },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const parsed = new ZodValidationPipe(IngestLocationsSchema).transform(
      rawBody,
    ) as IngestLocationsDto;

    return this.svc.ingestBatch(req.childDevice, parsed.points);
  }
}
