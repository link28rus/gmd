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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentRequiredGuard } from '../consent/guards/consent-required.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AudioService } from './audio.service';
import {
  CreateAudioSessionSchema,
  type CreateAudioSessionDto,
  type CreateAudioSessionResponse,
} from './dto/audio.dto';

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

@Controller('audio/sessions')
@UseGuards(JwtAuthGuard, ConsentRequiredGuard)
export class ParentAudioController {
  constructor(@Inject(AudioService) private readonly svc: AudioService) {}

  // 6 запусков в минуту — разумный потолок UX и защита от случайных циклов.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async start(
    @Req() req: AuthedRequest,
    @Body(new ZodValidationPipe(CreateAudioSessionSchema)) dto: CreateAudioSessionDto,
  ): Promise<CreateAudioSessionResponse> {
    return this.svc.startSession({
      familyId: req.user.familyId,
      userId: req.user.userId,
      childId: dto.childId,
      durationSec: dto.durationSec,
      hiddenMode: dto.hiddenMode,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async stop(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.svc.parentStop({
      sessionId: id,
      userId: req.user.userId,
      familyId: req.user.familyId,
    });
  }
}
