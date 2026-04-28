import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DeviceCommand } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import type { AudioWsConnInfo } from '../audio/dto/audio.dto';

// TTL на команду: если child не забрал её за это время, помечаем как
// expired при следующем pending-запросе. 5 минут — щедрый запас поверх
// 2-минутного heartbeat-окна, но не настолько, чтобы «старые» сигналы
// неожиданно срабатывали через полчаса.
const COMMAND_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class DeviceCommandsService {
  private readonly logger = new Logger(DeviceCommandsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FcmService) private readonly fcm: FcmService,
  ) {}

  // Родитель: отправить сигнал конкретному ребёнку. Возвращает command.id —
  // пригодится для последующего отслеживания статуса, если понадобится.
  async sendSignal(
    familyId: string,
    childId: string,
    createdByUserId: string,
  ): Promise<{ commandId: string; expiresAt: string }> {
    const child = await this.prisma.child.findFirst({
      where: { id: childId, familyId, deletedAt: null },
    });
    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }
    const device = await this.prisma.childDevice.findFirst({
      where: { childId, revokedAt: null },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'no_active_device',
        message: 'Child has no active device',
      });
    }

    // Если уже есть живая pending-команда того же типа — возвращаем её,
    // чтобы двойной клик родителя не плодил очередь из 5 сигналов.
    const now = new Date();
    const existing = await this.prisma.deviceCommand.findFirst({
      where: {
        childDeviceId: device.id,
        type: 'PLAY_SIGNAL',
        status: 'pending',
        expiresAt: { gt: now },
      },
    });
    if (existing) {
      // Дублирующий клик в течение TTL — всё равно толкаем FCM, на случай
      // если первый push не доехал до устройства (offline на момент создания).
      void this.fcm
        .sendDataMessage(device.id, device.fcmToken, {
          type: 'PLAY_SIGNAL',
          commandId: existing.id,
        })
        .catch((err) => this.logger.warn(`FCM PLAY_SIGNAL retry failed: ${String(err)}`));
      return { commandId: existing.id, expiresAt: existing.expiresAt.toISOString() };
    }

    const expiresAt = new Date(now.getTime() + COMMAND_TTL_MS);
    const cmd = await this.prisma.deviceCommand.create({
      data: {
        childDeviceId: device.id,
        type: 'PLAY_SIGNAL',
        status: 'pending',
        createdByUserId,
        expiresAt,
      },
    });

    // FCM high-priority push для мгновенной доставки (1-3с вместо до 2 минут
    // poll-цикла). Очередь команд остаётся как fallback — если FCM упал/нет
    // токена/устройство offline >60с TTL, child заберёт PLAY_SIGNAL
    // при следующем poll'е через /child/commands/pending.
    void this.fcm
      .sendDataMessage(device.id, device.fcmToken, {
        type: 'PLAY_SIGNAL',
        commandId: cmd.id,
      })
      .catch((err) => this.logger.warn(`FCM PLAY_SIGNAL push failed: ${String(err)}`));

    return { commandId: cmd.id, expiresAt: cmd.expiresAt.toISOString() };
  }

  // Child-устройство: забрать список pending-команд. Попутно помечаем как
  // expired команды, которые пропустили окно доставки — это единственная
  // точка, где это происходит (pg_cron не нужен, их мало).
  //
  // v0.36.0-rc.2: дедупликация START_AUDIO + STOP_AUDIO для одной sessionId.
  // Сценарий race: parent создал сессию → backend поставил START_AUDIO в очередь
  // (TTL 180s); ребёнок не успел запустить аудио до watchdog timeout → backend
  // поставил STOP_AUDIO. К моменту следующего poll'а в очереди обе команды для
  // одной мёртвой сессии. Если отдать обе — child запускает Flutter engine и
  // через 145мс глушит. Реально аудио не запускается, batter wasted, parent видит
  // «не отвечает» уже в следующий раз. Решение: если для одной sessionId есть
  // и START, и STOP — обе помечаем expired, ничего не отдаём.
  async listPending(
    deviceId: string,
  ): Promise<Array<{ id: string; type: string; payload: unknown; createdAt: string }>> {
    const now = new Date();
    await this.prisma.deviceCommand.updateMany({
      where: {
        childDeviceId: deviceId,
        status: 'pending',
        expiresAt: { lte: now },
      },
      data: { status: 'expired' },
    });
    const commands = await this.prisma.deviceCommand.findMany({
      where: {
        childDeviceId: deviceId,
        status: 'pending',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Дедупликация: собираем sessionId из START_AUDIO + STOP_AUDIO. Если
    // одна и та же sessionId встречается в обоих типах — глушим обе команды.
    const startSessions = new Set<string>();
    const stopSessions = new Set<string>();
    for (const c of commands) {
      const sid = (c.payload as { sessionId?: unknown } | null)?.sessionId;
      if (typeof sid !== 'string') continue;
      if (c.type === 'START_AUDIO') startSessions.add(sid);
      else if (c.type === 'STOP_AUDIO') stopSessions.add(sid);
    }
    const dropSessions = new Set<string>();
    for (const sid of startSessions) {
      if (stopSessions.has(sid)) dropSessions.add(sid);
    }
    if (dropSessions.size > 0) {
      const idsToExpire = commands
        .filter((c) => {
          if (c.type !== 'START_AUDIO' && c.type !== 'STOP_AUDIO') return false;
          const sid = (c.payload as { sessionId?: unknown } | null)?.sessionId;
          return typeof sid === 'string' && dropSessions.has(sid);
        })
        .map((c) => c.id);
      if (idsToExpire.length > 0) {
        await this.prisma.deviceCommand.updateMany({
          where: { id: { in: idsToExpire } },
          data: { status: 'expired' },
        });
      }
    }

    const filtered = commands.filter((c) => {
      if (c.type !== 'START_AUDIO' && c.type !== 'STOP_AUDIO') return true;
      const sid = (c.payload as { sessionId?: unknown } | null)?.sessionId;
      if (typeof sid !== 'string') return true;
      return !dropSessions.has(sid);
    });

    return filtered.map((c: DeviceCommand) => ({
      id: c.id,
      type: c.type,
      payload: c.payload,
      createdAt: c.createdAt.toISOString(),
    }));
  }

  // Child-устройство: подтвердить выполнение команды. Повторный ack —
  // идемпотентен (returns ok without error).
  async ackCommand(deviceId: string, commandId: string): Promise<void> {
    const cmd = await this.prisma.deviceCommand.findFirst({
      where: { id: commandId, childDeviceId: deviceId },
    });
    if (!cmd) {
      throw new NotFoundException({ code: 'command_not_found', message: 'Command not found' });
    }
    if (cmd.status === 'pending') {
      await this.prisma.deviceCommand.update({
        where: { id: cmd.id },
        data: { status: 'executed', executedAt: new Date() },
      });
    }
  }

  /**
   * Enqueue START_AUDIO для child-устройства (v0.35: WebSocket-relay).
   * Payload содержит sessionId, координаты подключения к WS-relay и durationSec.
   * Child заберёт через next /child/commands/pending poll и откроет WS.
   *
   * AUDIO_ANSWER (v0.32–v0.34) больше не используется: с WS-relay child'у не нужен
   * SDP-answer родителя — оба клиента подключаются к серверу независимо.
   */
  async enqueueAudioStart(
    childDeviceId: string,
    sessionId: string,
    ws: AudioWsConnInfo,
    durationSec: number,
    createdByUserId: string,
    ttlMs = 60_000,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.deviceCommand.create({
      data: {
        childDeviceId,
        type: 'START_AUDIO',
        status: 'pending',
        createdByUserId,
        expiresAt,
        payload: { sessionId, ws, durationSec } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async enqueueAudioStop(
    childDeviceId: string,
    sessionId: string,
    createdByUserId: string,
  ): Promise<void> {
    // TTL 180s (v0.34.4): poll в mobile-child привязан к location-heartbeat
    // (каждые 120с), 60с не перекрывало один цикл → команда expire'илась до доставки.
    // 180s даёт запас на 1-2 poll-цикла.
    const expiresAt = new Date(Date.now() + 180_000);
    await this.prisma.deviceCommand.create({
      data: {
        childDeviceId,
        type: 'STOP_AUDIO',
        status: 'pending',
        createdByUserId,
        expiresAt,
        payload: { sessionId } as Prisma.InputJsonValue,
      },
    });
  }
}
