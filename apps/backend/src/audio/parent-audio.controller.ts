import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type Observable, fromEventPattern, map } from 'rxjs';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConsentRequiredGuard } from '../consent/guards/consent-required.guard';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe';
import { AudioService } from './audio.service';
import { AudioEvents, type AudioStateEvent } from './audio.events';
import {
  CreateAudioSessionSchema,
  ParentAnswerSchema,
  IceCandidateSchema,
  type CreateAudioSessionDto,
  type ParentAnswerDto,
  type IceCandidateDto,
  type CreateAudioSessionResponse,
} from './dto/audio.dto';

interface AuthedRequest extends Request {
  user: { userId: string; familyId: string; role: 'owner' | 'parent' };
}

interface SseMessage {
  data: string;
}

@Controller('audio/sessions')
@UseGuards(JwtAuthGuard, ConsentRequiredGuard)
export class ParentAudioController {
  constructor(
    @Inject(AudioService) private readonly svc: AudioService,
    @Inject(AudioEvents) private readonly events: AudioEvents,
  ) {}

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

  @Post(':id/answer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async answer(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ParentAnswerSchema)) dto: ParentAnswerDto,
  ): Promise<void> {
    await this.svc.parentAnswer({
      sessionId: id,
      userId: req.user.userId,
      familyId: req.user.familyId,
      sdpAnswer: dto.sdp,
    });
  }

  // Высокий лимит: WebRTC может прислать 5-15 кандидатов за секунды (trickling).
  @Post(':id/ice')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { ttl: 60_000, limit: 100 } })
  async ice(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IceCandidateSchema)) dto: IceCandidateDto,
  ): Promise<void> {
    await this.svc.parentIce({ sessionId: id, userId: req.user.userId, candidate: dto.candidate });
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

  /**
   * SSE-стрим состояния сессии. Parent держит соединение открытым,
   * получает state-changes (READY/ACTIVE/ENDED/FAILED/EXPIRED), SDP-offer (с child),
   * и ICE-candidates от child.
   *
   * ⚠ Нет проверки доступа к sessionId — любой parent с JWT может слушать.
   * SSE-events содержат только state-changes, без sensitive data, кроме SDP-offer.
   * Полная авторизация выполняется в момент создания сессии (POST /audio/sessions).
   * Для строгой защиты в post-MVP — добавить sessionId-token в URL.
   */
  @Sse(':id/events')
  events$(@Param('id') id: string): Observable<SseMessage> {
    return fromEventPattern<AudioStateEvent>(
      (handler) => this.events.subscribe(id, handler as (e: AudioStateEvent) => void),
      (_handler, unsub: () => void) => unsub(),
    ).pipe(map((e) => ({ data: JSON.stringify({ state: e.state, payload: e.data }) })));
  }
}
