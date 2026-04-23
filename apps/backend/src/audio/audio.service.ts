import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService, SETTINGS_KEYS } from '../app-settings/app-settings.service';
import { DeviceCommandsService } from '../device-commands/device-commands.service';
import { AudioEvents } from './audio.events';
import type { CreateAudioSessionResponse, TurnCreds } from './dto/audio.dto';

interface StartSessionParams {
  familyId: string;
  userId: string;
  childId: string;
  durationSec?: number;
  hiddenMode?: boolean;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
    @Inject(DeviceCommandsService) private readonly commands: DeviceCommandsService,
    @Inject(AudioEvents) private readonly events: AudioEvents,
  ) {}

  /**
   * RFC 5766 REST API for time-limited TURN creds.
   * username = "<unix_ts_expiry>:<session_id>"
   * password = base64(HMAC_SHA1(static-auth-secret, username))
   * coturn проверяет HMAC локально, БД для auth не нужна.
   *
   * Env: TURN_SHARED_SECRET (обязательно), TURN_PUBLIC_HOST (обязательно),
   * TURN_PUBLIC_PORT (default 3478).
   */
  generateTurnCreds(sessionId: string, ttlSec: number): TurnCreds {
    const secret = process.env.TURN_SHARED_SECRET;
    const host = process.env.TURN_PUBLIC_HOST;
    const port = process.env.TURN_PUBLIC_PORT ?? '3478';

    if (!secret) {
      throw new Error('TURN_SHARED_SECRET env variable must be configured');
    }
    if (!host) {
      throw new Error('TURN_PUBLIC_HOST env variable must be configured');
    }

    const expiry = Math.floor(Date.now() / 1000) + ttlSec;
    const username = `${expiry}:${sessionId}`;
    const password = createHmac('sha1', secret).update(username).digest('base64');

    return {
      url: `turn:${host}:${port}`,
      username,
      password,
      ttl: ttlSec,
    };
  }

  /**
   * Создать audio-сессию по запросу родителя. Алгоритм:
   * 1) child должен принадлежать family parent'а
   * 2) у child должно быть активное устройство
   * 3) не должно быть другой активной сессии (PENDING/READY/ACTIVE)
   * 4) durationSec clamp в [min, max] из app_settings
   * 5) hiddenMode уважает app_settings.audio.hidden_mode_allowed
   * 6) Создаётся AudioSession в state=PENDING
   * 7) Генерируются TURN-creds (TTL = readyTimeout + duration + buffer)
   * 8) В DeviceCommand'ы кладётся START_AUDIO с payload {sessionId, turnCreds, duration}
   *    — child заберёт через next short-poll
   * 9) Audit-запись REQUESTED
   * 10) Event emit для SSE-подписчиков
   * 11) Запланирован expireIfStuck(sessionId) через readyTimeout — на случай если
   *     child не ответит (offline, OEM-block).
   */
  async startSession(p: StartSessionParams): Promise<CreateAudioSessionResponse> {
    const child = await this.prisma.child.findFirst({
      where: { id: p.childId, familyId: p.familyId, deletedAt: null },
    });
    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }

    const device = await this.prisma.childDevice.findFirst({
      where: { childId: p.childId, revokedAt: null },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'no_active_device',
        message: 'Child has no active device',
      });
    }

    const existing = await this.prisma.audioSession.findFirst({
      where: { childId: p.childId, state: { in: ['PENDING', 'READY', 'ACTIVE'] } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'session_already_active',
        message: 'Another audio session is already in progress for this child',
        sessionId: existing.id,
      });
    }

    const min = await this.settings.getNumber(SETTINGS_KEYS.AUDIO_MIN_DURATION_SEC, 30);
    const max = await this.settings.getNumber(SETTINGS_KEYS.AUDIO_MAX_DURATION_SEC, 1800);

    if (min > max) {
      this.logger.warn(
        `audio.min_duration_sec (${min}) > audio.max_duration_sec (${max}) — settings inverted, clamp result will be unpredictable. Admin should fix in /admin/settings/audio.`,
      );
    }

    const def = await this.settings.getNumber(SETTINGS_KEYS.AUDIO_DEFAULT_DURATION_SEC, 300);
    const requested = p.durationSec ?? def;
    const durationSec = Math.max(min, Math.min(max, requested));

    const hiddenAllowed = await this.settings.getBool(
      SETTINGS_KEYS.AUDIO_HIDDEN_MODE_ALLOWED,
      true,
    );
    const hiddenMode = (p.hiddenMode ?? true) && hiddenAllowed;

    const readyTimeoutSec = await this.settings.getNumber(
      SETTINGS_KEYS.AUDIO_CHILD_READY_TIMEOUT_SEC,
      45,
    );

    let session;
    try {
      session = await this.prisma.audioSession.create({
        data: {
          childId: p.childId,
          childDeviceId: device.id,
          requestedById: p.userId,
          state: 'PENDING',
          hiddenMode,
          durationSec,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Гонка с другим запросом: уникальный partial index пресёк дубль.
        // Возвращаем 409 как если бы findFirst поймал.
        throw new ConflictException({
          code: 'session_already_active',
          message: 'Another audio session is already in progress for this child',
        });
      }
      throw err;
    }

    const ttl = readyTimeoutSec + durationSec + 60;
    const turnCreds = this.generateTurnCreds(session.id, ttl);

    await this.commands.enqueueAudioStart(
      device.id,
      session.id,
      turnCreds,
      durationSec,
      p.userId,
      readyTimeoutSec * 1000,
    );

    await this.prisma.audioAuditLog.create({
      data: {
        sessionId: session.id,
        event: 'REQUESTED',
        actorUserId: p.userId,
        actorIp: p.ip,
        userAgent: p.userAgent?.slice(0, 500),
        metadata: { durationSec, hiddenMode },
      },
    });

    this.events.emitState(session.id, 'PENDING');

    setTimeout(() => {
      this.expireIfStuck(session.id).catch((err) =>
        this.logger.error(`expireIfStuck failed for ${session.id}: ${String(err)}`),
      );
    }, readyTimeoutSec * 1000);

    return {
      id: session.id,
      state: 'PENDING',
      expiresAt: new Date(Date.now() + readyTimeoutSec * 1000).toISOString(),
      turnCreds,
    };
  }

  /**
   * Child прислал SDP-offer → переход PENDING → READY.
   * Безопасность: deviceId должен совпадать с childDeviceId сессии.
   */
  async childReady(p: { sessionId: string; deviceId: string; sdpOffer: string }): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
    if (!session || session.childDeviceId !== p.deviceId) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    if (session.state !== 'PENDING') {
      throw new ConflictException({ code: 'invalid_state', state: session.state });
    }
    await this.prisma.audioSession.update({
      where: { id: p.sessionId },
      data: { state: 'READY', readyAt: new Date(), sdpOffer: p.sdpOffer },
    });
    this.events.emitState(p.sessionId, 'READY', { sdp: p.sdpOffer });
  }

  /**
   * Child прислал ICE-candidate. Сохраняем в буфер и emit для SSE-подписчиков.
   * Допустимо в состояниях PENDING/READY/ACTIVE — candidate trickling.
   */
  async childIce(p: { sessionId: string; deviceId: string; candidate: string }): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
    if (!session || session.childDeviceId !== p.deviceId) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    if (!['PENDING', 'READY', 'ACTIVE'].includes(session.state)) {
      throw new ConflictException({ code: 'invalid_state', state: session.state });
    }
    await this.prisma.audioIceCandidate.create({
      data: { sessionId: p.sessionId, side: 'child', candidate: p.candidate },
    });
    this.events.emitState(p.sessionId, 'ICE', { side: 'child', candidate: p.candidate });
  }

  /**
   * Child сообщил об ошибке (микрофон отказан, занят, OEM-блок, etc.).
   * Идемпотентно: если уже FAILED/ENDED/EXPIRED — no-op.
   */
  async childError(p: {
    sessionId: string;
    deviceId: string;
    code: 'PERMISSION_DENIED' | 'MIC_BUSY' | 'OEM_BLOCKED' | 'NETWORK_ERROR' | 'UNKNOWN';
    message?: string;
  }): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
    if (!session || session.childDeviceId !== p.deviceId) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    if (['ENDED', 'FAILED', 'EXPIRED'].includes(session.state)) {
      return; // идемпотентно
    }
    await this.prisma.audioSession.update({
      where: { id: p.sessionId },
      data: { state: 'FAILED', failureReason: p.code, endedAt: new Date() },
    });
    await this.prisma.audioAuditLog.create({
      data: {
        sessionId: p.sessionId,
        event: 'FAILED',
        metadata: { code: p.code, message: p.message },
      },
    });
    this.events.emitState(p.sessionId, 'FAILED', { reason: p.code });
  }

  /**
   * Parent прислал SDP-answer → переход READY → ACTIVE.
   * Запускает auto-stop таймер на durationSec секунд.
   */
  async parentAnswer(p: {
    sessionId: string;
    userId: string;
    familyId: string;
    sdpAnswer: string;
  }): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
    if (!session || session.requestedById !== p.userId) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    if (session.state !== 'READY') {
      throw new ConflictException({ code: 'invalid_state', state: session.state });
    }
    await this.prisma.audioSession.update({
      where: { id: p.sessionId },
      data: { state: 'ACTIVE', activeAt: new Date(), sdpAnswer: p.sdpAnswer },
    });
    await this.prisma.audioAuditLog.create({
      data: { sessionId: p.sessionId, event: 'STARTED', actorUserId: p.userId },
    });
    this.events.emitState(p.sessionId, 'ACTIVE');

    // Auto-stop через durationSec
    // ⚠ MVP-ограничение: setTimeout живёт в памяти процесса (см. expireIfStuck).
    // pg_cron-fallback в Task 13.
    setTimeout(() => {
      this.autoStopIfActive(p.sessionId, p.userId).catch((err) =>
        this.logger.error(`autoStopIfActive failed for ${p.sessionId}: ${String(err)}`),
      );
    }, session.durationSec * 1000);
  }

  async parentIce(p: { sessionId: string; userId: string; candidate: string }): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
    if (!session || session.requestedById !== p.userId) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    if (!['READY', 'ACTIVE'].includes(session.state)) {
      throw new ConflictException({ code: 'invalid_state', state: session.state });
    }
    await this.prisma.audioIceCandidate.create({
      data: { sessionId: p.sessionId, side: 'parent', candidate: p.candidate },
    });
    this.events.emitState(p.sessionId, 'ICE', { side: 'parent', candidate: p.candidate });
  }

  async parentStop(p: { sessionId: string; userId: string; familyId: string }): Promise<void> {
    // Forbidden check здесь — endSession его не делает (вызывается также из watchdog).
    const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
    if (!session) return; // идемпотентно
    if (session.requestedById !== p.userId) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    await this.endSession(p.sessionId, p.userId, 'ENDED');
  }

  /**
   * Общий helper для terminal-state transitions (ENDED / FAILED / EXPIRED).
   * Идемпотентно: если уже terminal — no-op.
   * Сообщает child через STOP_AUDIO команду + audit + emit.
   */
  private async endSession(
    sessionId: string,
    actorUserId: string,
    finalState: 'ENDED' | 'FAILED' | 'EXPIRED',
  ): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    if (['ENDED', 'FAILED', 'EXPIRED'].includes(session.state)) return;

    const actualSec = session.activeAt
      ? Math.floor((Date.now() - session.activeAt.getTime()) / 1000)
      : 0;
    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: { state: finalState, endedAt: new Date(), actualSec },
    });
    await this.prisma.audioAuditLog.create({
      data: {
        sessionId,
        event: finalState === 'ENDED' ? 'STOPPED' : 'EXPIRED',
        actorUserId,
      },
    });
    if (session.childDeviceId) {
      await this.commands.enqueueAudioStop(session.childDeviceId, sessionId, actorUserId);
    }
    this.events.emitState(sessionId, finalState);
  }

  private async autoStopIfActive(sessionId: string, userId: string): Promise<void> {
    const s = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
    if (s && s.state === 'ACTIVE') {
      await this.endSession(sessionId, userId, 'ENDED');
    }
  }

  /**
   * Watchdog: если PENDING сессия не дошла до READY за timeout — помечаем EXPIRED.
   * Идемпотентно: если уже не PENDING (READY/ACTIVE/ENDED/FAILED), ничего не делаем.
   *
   * ⚠ MVP-ограничение: setTimeout живёт в памяти процесса. При рестарте сервера
   * watchdog теряется — застрявшие в PENDING сессии не будут отмечены EXPIRED.
   * Решение в Task 13: pg_cron-задача, которая раз в минуту выполняет
   * UPDATE audio_sessions SET state='EXPIRED' WHERE state='PENDING' AND started_at < NOW()-...
   * (см. spec §11 Risks).
   */
  private async expireIfStuck(sessionId: string): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
    if (!session || session.state !== 'PENDING') return;
    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: { state: 'EXPIRED', endedAt: new Date(), failureReason: 'PARENT_TIMEOUT' },
    });
    await this.prisma.audioAuditLog.create({
      data: { sessionId, event: 'EXPIRED', metadata: { reason: 'child_no_ready' } },
    });
    this.events.emitState(sessionId, 'EXPIRED');
  }
}
