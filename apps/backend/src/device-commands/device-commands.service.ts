import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DeviceCommand } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TurnCreds } from '../audio/dto/audio.dto';

// TTL на команду: если child не забрал её за это время, помечаем как
// expired при следующем pending-запросе. 5 минут — щедрый запас поверх
// 2-минутного heartbeat-окна, но не настолько, чтобы «старые» сигналы
// неожиданно срабатывали через полчаса.
const COMMAND_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class DeviceCommandsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    return { commandId: cmd.id, expiresAt: cmd.expiresAt.toISOString() };
  }

  // Child-устройство: забрать список pending-команд. Попутно помечаем как
  // expired команды, которые пропустили окно доставки — это единственная
  // точка, где это происходит (pg_cron не нужен, их мало).
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
    return commands.map((c: DeviceCommand) => ({
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

  // Enqueue START_AUDIO для child-устройства. payload содержит sessionId
  // и TURN-креды. Child заберёт через next /child/commands/pending poll.
  async enqueueAudioStart(
    childDeviceId: string,
    sessionId: string,
    turnCreds: TurnCreds,
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
        payload: { sessionId, turnCreds, durationSec } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async enqueueAudioStop(
    childDeviceId: string,
    sessionId: string,
    createdByUserId: string,
  ): Promise<void> {
    // TTL 180s (v0.34.4) — см. комментарий в enqueueAudioAnswer. 30s не хватало
    // для одного poll-цикла mobile-child (heartbeat 120с).
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

  // Доставить SDP-answer родителя на child-устройство через DeviceCommand poll (v0.32.1).
  // Child заберёт AUDIO_ANSWER при следующем /child/commands/pending запросе и завершит
  // WebRTC handshake (setRemoteDescription).
  //
  // TTL 180s (v0.34.4): Plan E E2E показал что poll привязан к location-heartbeat
  // (каждые 120с), а TTL 60с не перекрывал один цикл poll'а → answer expire'ился
  // до доставки, сессия через какое-то время падала. 180s даёт запас на 1-2 poll-цикла.
  // Правильное решение post-MVP — отдельный command-poll timer в mobile-child.
  async enqueueAudioAnswer(
    childDeviceId: string,
    sessionId: string,
    sdp: string,
    createdByUserId: string,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + 180_000);
    await this.prisma.deviceCommand.create({
      data: {
        childDeviceId,
        type: 'AUDIO_ANSWER',
        status: 'pending',
        createdByUserId,
        expiresAt,
        payload: { sessionId, sdp } as Prisma.InputJsonValue,
      },
    });
  }
}
