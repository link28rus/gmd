import {
  Body,
  Controller,
  HttpCode,
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
import { SosSchema } from './dto/sos.dto';
import type { SosDto } from './dto/sos.dto';
import { SosService } from './sos.service';

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

@Controller('sos')
@UseGuards(ChildAuthGuard)
export class SosController {
  constructor(@Inject(SosService) private readonly svc: SosService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 300_000, limit: 3 } })
  async create(
    @Req() req: ChildRequest,
    @Body(new ZodValidationPipe(SosSchema)) dto: SosDto,
  ): Promise<{ sosId: string; createdAt: string }> {
    return this.svc.create(req.childDevice, dto);
  }
}
