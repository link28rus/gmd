import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

/**
 * v0.37: Firebase Cloud Messaging V1 API через firebase-admin SDK.
 *
 * Используется для high-priority push доставки команд ребёнку (мгновенный
 * START_AUDIO вместо ожидания poll-цикла 60-120с). Полезная нагрузка идёт в
 * `data` (НЕ `notification`), чтобы Android всегда вызывал
 * onMessageReceived → handler стартует SoundAroundService MODE_STREAM.
 *
 * Креденшалы: `FIREBASE_SA_KEY` (base64-encoded service-account.json).
 * Если переменной нет — сервис стартует в DISABLED состоянии и логирует warn'ом
 * каждый sendDataMessage(). Это позволяет dev-окружению работать без credentials,
 * fallback'ясь на poll-команды через DeviceCommand queue (как в v0.36).
 */
@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app: admin.app.App | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const b64 = process.env.FIREBASE_SA_KEY;
    if (!b64) {
      this.logger.warn(
        'FIREBASE_SA_KEY не задан — FCM disabled, fallback на poll-команды через DeviceCommand queue',
      );
      return;
    }
    try {
      const json = Buffer.from(b64, 'base64').toString('utf8');
      const sa = JSON.parse(json) as admin.ServiceAccount & { project_id?: string };
      this.app = admin.initializeApp({
        credential: admin.credential.cert(sa),
      });
      this.logger.log(`FCM initialized (project=${sa.project_id ?? 'unknown'})`);
    } catch (err) {
      this.logger.error(`FCM init failed: ${String(err)} — fallback на poll-команды`);
      this.app = null;
    }
  }

  isEnabled(): boolean {
    return this.app !== null;
  }

  /**
   * Послать data-message ребёнку. Возвращает true если FCM успешно принял,
   * false иначе (caller продолжает с poll-fallback).
   *
   * UNREGISTERED / INVALID_ARGUMENT (token устарел) → автоматически очищаем
   * fcmToken в БД, чтобы дальнейшие отправки не тратили квоту.
   */
  async sendDataMessage(
    deviceId: string,
    fcmToken: string | null,
    data: Record<string, string>,
  ): Promise<boolean> {
    if (!this.app || !fcmToken) return false;
    try {
      const msg = await admin.messaging(this.app).send({
        token: fcmToken,
        data,
        android: {
          priority: 'high', // high = wake-up, doze-bypass, data-message immediate
          ttl: 60_000, // 60s — если устройство offline дольше, fallback на poll
        },
      });
      this.logger.log(`FCM sent to device=${deviceId}: ${msg}`);
      return true;
    } catch (err) {
      const code = (err as { errorInfo?: { code?: string } } | null)?.errorInfo?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        this.logger.warn(
          `FCM token expired/invalid for device=${deviceId} (${code}) — clearing in DB`,
        );
        await this.prisma.childDevice
          .update({
            where: { id: deviceId },
            data: { fcmToken: null, fcmTokenUpdatedAt: new Date() },
          })
          .catch(() => {
            /* ignore: device might have been deleted */
          });
      } else {
        this.logger.error(`FCM send failed for device=${deviceId}: ${String(err)}`);
      }
      return false;
    }
  }
}
