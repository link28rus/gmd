import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ChildAuthGuard } from '../child-device/guards/child-auth.guard';
import type { ChildAuthContext } from '../child-device/child-device.service';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AudioService } from './audio.service';
import {
  ChildReadySchema,
  IceCandidateSchema,
  ChildErrorSchema,
  type ChildReadyDto,
  type IceCandidateDto,
  type ChildErrorDto,
} from './dto/audio.dto';

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

@Controller('child/audio/sessions')
@UseGuards(ChildAuthGuard)
export class ChildAudioController {
  constructor(@Inject(AudioService) private readonly svc: AudioService) {}

  // child прислал SDP-offer → переход PENDING → READY
  @Post(':id/ready')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async ready(
    @Req() req: ChildRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChildReadySchema)) dto: ChildReadyDto,
  ): Promise<void> {
    await this.svc.childReady({
      sessionId: id,
      deviceId: req.childDevice.deviceId,
      sdpOffer: dto.sdp,
    });
  }

  // ICE-candidate trickling — высокий лимит
  @Post(':id/ice')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 100 } })
  async ice(
    @Req() req: ChildRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IceCandidateSchema)) dto: IceCandidateDto,
  ): Promise<void> {
    await this.svc.childIce({
      sessionId: id,
      deviceId: req.childDevice.deviceId,
      candidate: dto.candidate,
    });
  }

  // Сообщить об ошибке (PERMISSION_DENIED, MIC_BUSY, OEM_BLOCKED, NETWORK_ERROR, UNKNOWN)
  @Post(':id/error')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async error(
    @Req() req: ChildRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChildErrorSchema)) dto: ChildErrorDto,
  ): Promise<void> {
    await this.svc.childError({
      sessionId: id,
      deviceId: req.childDevice.deviceId,
      code: dto.code,
      message: dto.message,
    });
  }
}
