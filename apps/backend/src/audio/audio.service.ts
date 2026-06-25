import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AudioFailureReason, AudioSession } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService, SETTINGS_KEYS } from '../app-settings/app-settings.service';
import { DeviceCommandsService } from '../device-commands/device-commands.service';
import { FcmService } from '../fcm/fcm.service';
import { AudioRelay } from './audio.relay';
import { AudioTokenService } from './audio-token.service';
import type { CreateAudioSessionResponse, AudioWsConnInfo } from './dto/audio.dto';

interface StartSessionParams {
  familyId: string;
  userId: string;
  childId: string;
  durationSec?: number;
  hiddenMode?: boolean;
  ip?: string;
  userAgent?: string;
}

export type ChildErrorCode =
  | 'PERMISSION_DENIED'
  | 'MIC_BUSY'
  | 'OEM_BLOCKED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

@Injectable()
export class AudioService implements OnModuleInit {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
    @Inject(DeviceCommandsService) private readonly commands: DeviceCommandsService,
    @Inject(AudioRelay) private readonly relay: AudioRelay,
    @Inject(AudioTokenService) private readonly tokens: AudioTokenService,
    @Inject(FcmService) private readonly fcm: FcmService,
  ) {}

  /**
   * v0.37.0-rc.2: при рестарте backend setTimeout'ы expireIfStuck/autoStop
   * теряются, и PENDING/ACTIVE сессии висят вечно — каждый новый POST
   * /audio/sessions для того же ребёнка получает 409 session_already_active.
   *
   * При старте модуля чистим все PENDING/READY/ACTIVE сессии старше
   * AUDIO_CHILD_READY_TIMEOUT_SEC + durationSec + buffer (5 минут как разумный
   * максимум для любых сессий). Это идемпотентно и безопасно — реально живые
   * сессии этим cleanup'ом не убьются (они моложе 5 мин в любом нормальном
   * сценарии).
   *
   * TODO v0.38: pg_cron каждую минуту делать то же самое для случая когда
   * backend живой, но отдельные setTimeout'ы потерялись (например после OOM).
   */
  async onModuleInit(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 5 * 60_000);
      const stuck = await this.prisma.audioSession.findMany({
        where: {
          state: { in: ['PENDING', 'READY', 'ACTIVE'] },
          startedAt: { lt: cutoff },
        },
        select: { id: true, childId: true, state: true, startedAt: true, childDeviceId: true },
      });
      if (stuck.length === 0) {
        this.logger.log('startup cleanup: no stuck sessions found');
        return;
      }
      this.logger.warn(`startup cleanup: expiring ${stuck.length} stuck session(s)`);
      for (const s of stuck) {
        this.logger.warn(
          `  → ${s.id} child=${s.childId} state=${s.state} startedAt=${s.startedAt.toISOString()}`,
        );
        await this.expireOrFail(s.id, 'EXPIRED', 'NETWORK_ERROR').catch((err) =>
          this.logger.warn(`  cleanup expireOrFail(${s.id}) failed: ${String(err)}`),
        );
      }
    } catch (err) {
      this.logger.error(`startup cleanup failed: ${String(err)}`);
    }
  }

  /**
   * Старт audio-сессии родителем (v0.35: WebSocket-relay).
   *
   * Алгоритм:
   * 1) child принадлежит family parent'а
   * 2) у child есть активное устройство
   * 3) нет другой активной сессии (PENDING/ACTIVE — READY устаревшее)
   * 4) durationSec clamp в [min, max] из app_settings
   * 5) hiddenMode уважает app_settings.audio.hidden_mode_allowed
   * 6) Создаётся AudioSession в state=PENDING
   * 7) Генерируется JWT-токен для child WS-подключения; payload {sid, role=child, sub=deviceId}
   * 8) Аналогичный token для parent (sub=userId), отдаётся в response
   * 9) START_AUDIO кладётся в device-command queue с {sessionId, ws:{url,token,...}, durationSec}
   * 10) Audit REQUESTED, watchdog expireIfStuck через readyTimeoutSec
   *
   * Сессия переходит в ACTIVE автоматически через AudioRelay.onActivate (gateway),
   * когда оба сокета (child + parent) подключатся.
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

    let session: AudioSession;
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
        throw new ConflictException({
          code: 'session_already_active',
          message: 'Another audio session is already in progress for this child',
        });
      }
      throw err;
    }

    // TTL = окно ожидания child'а + длительность + буфер на reconnect.
    const ttlSec = readyTimeoutSec + durationSec + 60;
    const wsBaseUrl = this.getWsPublicUrl();

    const childWs = await this.buildWsConn({
      sessionId: session.id,
      role: 'child',
      sub: device.id,
      ttlSec,
      baseUrl: wsBaseUrl,
    });
    const parentWs = await this.buildWsConn({
      sessionId: session.id,
      role: 'parent',
      sub: p.userId,
      ttlSec,
      baseUrl: wsBaseUrl,
    });

    await this.commands.enqueueAudioStart(
      device.id,
      session.id,
      childWs,
      durationSec,
      p.userId,
      readyTimeoutSec * 1000,
    );

    // v0.37: parallel FCM push для мгновенной доставки (3-5s vs 60-120s poll).
    // Очередь команд остаётся как fallback — если FCM упал/нет токена, child
    // всё равно заберёт START_AUDIO при следующем poll'е (как в v0.36).
    // FCM-payload идентичен payload'у в DeviceCommand.
    void this.fcm
      .sendHybridDataMessage(
        device.id,
        { fcmToken: device.fcmToken, rustorePushToken: device.rustorePushToken },
        {
          type: 'START_AUDIO',
          sessionId: session.id,
          wsUrl: childWs.url,
          wsToken: childWs.token,
          ttlSec: String(childWs.ttlSec),
          durationSec: String(durationSec),
        },
      )
      .catch((err) => this.logger.warn(`push START_AUDIO failed: ${String(err)}`));

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

    setTimeout(() => {
      this.expireIfStuck(session.id).catch((err) =>
        this.logger.error(`expireIfStuck failed for ${session.id}: ${String(err)}`),
      );
    }, readyTimeoutSec * 1000);

    return {
      id: session.id,
      state: 'PENDING',
      expiresAt: new Date(Date.now() + readyTimeoutSec * 1000).toISOString(),
      ws: parentWs,
    };
  }

  /**
   * Вызывается из AudioGateway когда оба сокета (child + parent) подключились.
   * Идемпотентно: если сессия уже ACTIVE/ENDED/FAILED/EXPIRED — no-op.
   *
   * Запускает auto-stop таймер на durationSec секунд.
   * ⚠ MVP-ограничение: setTimeout живёт в памяти процесса. При рестарте сервера
   * watchdog теряется — застрявшие в ACTIVE сессии будут добиты:
   *   - Per-session 90s idle (см. AudioGateway.afterInit)
   *   - pg_cron-fallback в v0.35.1
   */
  async activateBySessionId(sessionId: string): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    if (session.state !== 'PENDING') return;

    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: { state: 'ACTIVE', activeAt: new Date() },
    });
    await this.prisma.audioAuditLog.create({
      data: { sessionId, event: 'STARTED', actorUserId: session.requestedById },
    });

    setTimeout(() => {
      this.autoStopIfActive(sessionId, session.requestedById).catch((err) =>
        this.logger.error(`autoStopIfActive failed for ${sessionId}: ${String(err)}`),
      );
    }, session.durationSec * 1000);

    this.logger.log(`session ${sessionId}: PENDING → ACTIVE`);
  }

  /**
   * v0.51.x (task #69): cleanup ghost-сессий, которые потеряли оба WS-конца.
   *
   * Существующий watchdog в [AudioGateway] ловит сессии, которые ещё ЖИВУТ в
   * relay-map (хотя бы один сокет открыт, но lastFrameTs > 90с). Но если оба
   * конца (producer+consumers) уже отвалились — relay удалил session из map
   * (см. [AudioRelay.detach]), и БД остаётся с state ∈ (PENDING/READY/ACTIVE)
   * НАВСЕГДА. Следующий POST /audio/sessions для того же child получает 409.
   *
   * Вызывается из watchdog'а каждые 30с (после WATCHDOG_INTERVAL_MS).
   * Идемпотентно — повторный вызов на той же сессии = no-op (expireOrFail
   * возвращается early при terminal state).
   *
   * Критерии cleanup'а (по приоритету):
   *   1. Hard expire (safety net) — `startedAt + durationSec + 30s < NOW()`:
   *      сессия должна была закрыться давно, но не закрылась → DURATION_EXPIRED.
   *      Не зависит от relay-state, защита от пропавших setTimeout'ов.
   *   2. PENDING > 60s без перехода в READY/ACTIVE и БЕЗ записи в relay-map:
   *      child не подключился к WS вовсе → CHILD_OFFLINE.
   *   3. READY/ACTIVE и БЕЗ записи в relay-map: оба сокета закрылись,
   *      session не получит больше фреймов → NETWORK_ERROR.
   *
   * Cessии которые ЕСТЬ в relay-map не трогаем — за ними следит другой
   * watchdog через [AudioRelay.findIdleSessions]. Эта функция покрывает
   * orphan-case когда relay уже её forgot.
   */
  async cleanupOrphans(activeRelaySessionIds: Set<string>): Promise<number> {
    const now = Date.now();
    const dbActive = await this.prisma.audioSession.findMany({
      where: { state: { in: ['PENDING', 'READY', 'ACTIVE'] } },
      select: { id: true, state: true, startedAt: true, durationSec: true },
    });
    if (dbActive.length === 0) return 0;

    let cleaned = 0;
    for (const session of dbActive) {
      const ageMs = now - session.startedAt.getTime();
      const hardExpireMs = (session.durationSec + 30) * 1000;
      const inRelay = activeRelaySessionIds.has(session.id);

      let reason: 'PARENT_TIMEOUT' | 'CHILD_OFFLINE' | 'NETWORK_ERROR' | null = null;

      if (ageMs > hardExpireMs) {
        // Hard expire safety net — независимо от relay.
        reason = 'PARENT_TIMEOUT';
      } else if (!inRelay) {
        // Orphan: relay уже забыл session.
        if (session.state === 'PENDING' && ageMs > 60_000) {
          reason = 'CHILD_OFFLINE';
        } else if (session.state !== 'PENDING' && ageMs > 30_000) {
          reason = 'NETWORK_ERROR';
        }
      }

      if (reason) {
        this.logger.warn(
          `cleanupOrphans: session=${session.id} state=${session.state} ageMs=${ageMs} reason=${reason}`,
        );
        await this.expireOrFail(session.id, 'EXPIRED', reason).catch((err) =>
          this.logger.error(`cleanupOrphans expireOrFail(${session.id}): ${String(err)}`),
        );
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Перевести сессию в EXPIRED/FAILED. Идемпотентно.
   * Используется watchdog'ом (idle timeout в gateway) и parent stop'ом.
   * Не закрывает сокеты сама — это дело caller'а (relay.terminate).
   */
  async expireOrFail(
    sessionId: string,
    finalState: 'EXPIRED' | 'FAILED',
    failureReason?: AudioFailureReason,
  ): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    if (['ENDED', 'FAILED', 'EXPIRED'].includes(session.state)) return;

    const actualSec = session.activeAt
      ? Math.floor((Date.now() - session.activeAt.getTime()) / 1000)
      : 0;
    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: {
        state: finalState,
        endedAt: new Date(),
        actualSec,
        failureReason: failureReason as Prisma.AudioSessionUpdateInput['failureReason'],
      },
    });
    await this.prisma.audioAuditLog.create({
      data: {
        sessionId,
        event: finalState === 'EXPIRED' ? 'EXPIRED' : 'FAILED',
        metadata: failureReason ? { reason: failureReason } : undefined,
      },
    });
    if (session.childDeviceId) {
      await this.commands.enqueueAudioStop(session.childDeviceId, sessionId, session.requestedById);
      // v0.37: FCM push STOP — мгновенно прервать stream на child'е.
      const device = await this.prisma.childDevice.findUnique({
        where: { id: session.childDeviceId },
        select: { fcmToken: true, rustorePushToken: true },
      });
      void this.fcm
        .sendHybridDataMessage(
          session.childDeviceId,
          {
            fcmToken: device?.fcmToken ?? null,
            rustorePushToken: device?.rustorePushToken ?? null,
          },
          {
            type: 'STOP_AUDIO',
            sessionId,
          },
        )
        .catch((err) => this.logger.warn(`push STOP_AUDIO failed: ${String(err)}`));
    }
  }

  /**
   * Проверка для AudioGateway: сессия валидна для подключения по WS?
   * - exists
   * - state ∈ {PENDING, ACTIVE} — для PENDING ожидаем оба connect, для ACTIVE — reconnect
   * - sub соответствует роли (childDeviceId для child, requestedById для parent)
   *
   * Возвращает session или null (gateway закроет 4404).
   */
  async validateSessionForWs(
    sessionId: string,
    role: 'child' | 'parent',
    sub: string,
  ): Promise<AudioSession | null> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
    if (!session) return null;
    if (session.state !== 'PENDING' && session.state !== 'ACTIVE') return null;
    if (role === 'child' && session.childDeviceId !== sub) return null;
    if (role === 'parent' && session.requestedById !== sub) return null;
    return session;
  }

  /**
   * Child прислал error через WS control frame. Идемпотентно: если уже terminal — no-op.
   */
  async markChildError(p: {
    sessionId: string;
    deviceId: string;
    code: ChildErrorCode;
    message?: string;
  }): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
    if (!session || session.childDeviceId !== p.deviceId) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    if (['ENDED', 'FAILED', 'EXPIRED'].includes(session.state)) return;

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
    // v0.35.0-rc.5: prefix `child_error:` парсится parent UI (use-audio-session.ts
    // handleCloseCode) → setErrorReason → читаемое сообщение про PERMISSION_DENIED/MIC_BUSY
    this.relay.terminate(p.sessionId, 4008, `child_error:${p.code}`);
  }

  async parentStop(p: { sessionId: string; userId: string; familyId: string }): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: p.sessionId } });
    if (!session) return;
    if (session.requestedById !== p.userId) {
      throw new ForbiddenException({ code: 'forbidden' });
    }
    await this.endSession(p.sessionId, p.userId, 'ENDED');
  }

  /**
   * Общий helper для terminal-state transitions.
   * Идемпотентно. Сообщает child через STOP_AUDIO + закрывает все WS относящиеся
   * к сессии (relay.terminate).
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
      // v0.37: FCM push STOP — мгновенно прервать stream на child'е (parent stop / auto-end).
      const device = await this.prisma.childDevice.findUnique({
        where: { id: session.childDeviceId },
        select: { fcmToken: true, rustorePushToken: true },
      });
      void this.fcm
        .sendHybridDataMessage(
          session.childDeviceId,
          {
            fcmToken: device?.fcmToken ?? null,
            rustorePushToken: device?.rustorePushToken ?? null,
          },
          {
            type: 'STOP_AUDIO',
            sessionId,
          },
        )
        .catch((err) => this.logger.warn(`push STOP_AUDIO (endSession) failed: ${String(err)}`));
    }
    this.relay.terminate(sessionId, 4008, 'session_ended');
  }

  private async autoStopIfActive(sessionId: string, userId: string): Promise<void> {
    const s = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
    if (s && s.state === 'ACTIVE') {
      await this.endSession(sessionId, userId, 'ENDED');
    }
  }

  /**
   * Watchdog для PENDING-сессий: child не подключился к WS за readyTimeoutSec.
   * Идемпотентно: если уже не PENDING — ничего не делаем.
   */
  private async expireIfStuck(sessionId: string): Promise<void> {
    const session = await this.prisma.audioSession.findUnique({ where: { id: sessionId } });
    if (!session || session.state !== 'PENDING') return;
    await this.prisma.audioSession.update({
      where: { id: sessionId },
      data: { state: 'EXPIRED', endedAt: new Date(), failureReason: 'PARENT_TIMEOUT' },
    });
    await this.prisma.audioAuditLog.create({
      data: { sessionId, event: 'EXPIRED', metadata: { reason: 'child_no_connect' } },
    });
    this.relay.terminate(sessionId, 4006, 'pending_timeout');
  }

  private async buildWsConn(p: {
    sessionId: string;
    role: 'child' | 'parent';
    sub: string;
    ttlSec: number;
    baseUrl: string;
  }): Promise<AudioWsConnInfo> {
    const token = await this.tokens.issue({
      sessionId: p.sessionId,
      role: p.role,
      sub: p.sub,
      ttlSec: p.ttlSec,
    });
    const url = `${p.baseUrl}?role=${p.role}&sessionId=${p.sessionId}&token=${token}`;
    return { url, token, ttlSec: p.ttlSec };
  }

  private getWsPublicUrl(): string {
    const url = process.env.AUDIO_WS_PUBLIC_URL;
    if (!url) {
      throw new Error(
        'AUDIO_WS_PUBLIC_URL env variable must be set (e.g. wss://periscop.pro/audio/ws)',
      );
    }
    return url;
  }
}
