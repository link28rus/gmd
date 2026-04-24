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
import { ChildErrorSchema, type ChildErrorDto } from './dto/audio.dto';

interface ChildRequest extends Request {
  childDevice: ChildAuthContext;
}

/**
 * v0.35: WebRTC signaling (/ready, /ice) удалён — child подключается напрямую к WS.
 * Остался только error-репорт: mobile-child может прислать сюда ошибку, если WS
 * вообще не получилось открыть (нет сети, JWT invalid, etc.). Через WS error
 * шлётся control-frame {op:'error', ...}.
 */
@Controller('child/audio/sessions')
@UseGuards(ChildAuthGuard)
export class ChildAudioController {
  constructor(@Inject(AudioService) private readonly svc: AudioService) {}

  @Post(':id/error')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async error(
    @Req() req: ChildRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChildErrorSchema)) dto: ChildErrorDto,
  ): Promise<void> {
    await this.svc.markChildError({
      sessionId: id,
      deviceId: req.childDevice.deviceId,
      code: dto.code,
      message: dto.message,
    });
  }
}
