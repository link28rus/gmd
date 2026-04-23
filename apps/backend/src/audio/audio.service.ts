import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
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

    const session = await this.prisma.audioSession.create({
      data: {
        childId: p.childId,
        childDeviceId: device.id,
        requestedById: p.userId,
        state: 'PENDING',
        hiddenMode,
        durationSec,
      },
    });

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
   * Watchdog: если PENDING сессия не дошла до READY за timeout — помечаем EXPIRED.
   * Идемпотентно: если уже не PENDING (READY/ACTIVE/ENDED/FAILED), ничего не делаем.
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
