import type { OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';

/**
 * v0.37 / v0.51: hybrid push-доставка через Firebase Cloud Messaging (V1 API
 * через firebase-admin SDK) и RuStore Push (VKPNS, HTTP v1 REST API).
 *
 * Используется для high-priority доставки команд ребёнку (мгновенный START_AUDIO
 * вместо ожидания poll-цикла 60-120с) и push'ей родителю (geofence/SOS/audio
 * ack). Полезная нагрузка идёт в `data` (НЕ `notification`), чтобы Android
 * всегда вызывал onMessageReceived → handler обрабатывает state-transition.
 *
 * Каналы:
 *   FCM — основной для устройств с Google Play Services.
 *   RuStore Push — для устройств без GMS (HMS, AOSP, MIUI без GMS) и для
 *                  bypass MIUI Restricted Settings (lesson #23-24): trusted
 *                  installer + push API не сбрасывают a11y/Device Admin при
 *                  обновлениях через RuStore.
 *
 * Стратегия выбора канала per-device:
 *   1. Если у устройства есть rustorePushToken — предпочитаем RuStore (он
 *      переживает MIUI). Если ошибка/невалидный — fallback на FCM.
 *   2. Иначе FCM.
 *   3. Иначе fallback на poll-команду через DeviceCommand queue.
 *
 * Креденшалы:
 *   FIREBASE_SA_KEY                      — base64 service-account.json, FCM admin.
 *   RUSTORE_PUSH_PROJECT_ID_CHILD        — projectId mobile-child app в RuStore.
 *   RUSTORE_PUSH_SERVICE_TOKEN_CHILD     — Bearer service-token mobile-child.
 *   RUSTORE_PUSH_PROJECT_ID_PARENT       — projectId mobile-parent app.
 *   RUSTORE_PUSH_SERVICE_TOKEN_PARENT    — Bearer service-token mobile-parent.
 *
 * Если env-переменная для канала отсутствует — этот канал disabled и
 * sendHybrid* деградирует на оставшийся канал. Это позволяет dev-окружению
 * работать без credentials, fallback'ясь на poll-команды через DeviceCommand
 * queue.
 */
@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app: admin.app.App | null = null;

  // v0.51 RuStore Push конфиг (per-app, два набора credentials).
  private rustoreChildProjectId: string | null = null;
  private rustoreChildServiceToken: string | null = null;
  private rustoreParentProjectId: string | null = null;
  private rustoreParentServiceToken: string | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const b64 = process.env.FIREBASE_SA_KEY;
    if (!b64) {
      this.logger.warn(
        'FIREBASE_SA_KEY не задан — FCM disabled, fallback на poll-команды через DeviceCommand queue',
      );
    } else {
      try {
        const json = Buffer.from(b64, 'base64').toString('utf8');
        const sa = JSON.parse(json) as admin.ServiceAccount & { project_id?: string };
        this.app = admin.initializeApp({
          credential: admin.credential.cert(sa),
        });
        this.logger.log(`FCM initialized (project=${sa.project_id ?? 'unknown'})`);
      } catch (err) {
        this.logger.error(`FCM init failed: ${String(err)}`);
        this.app = null;
      }
    }

    // RuStore Push (lesson #24).
    this.rustoreChildProjectId = process.env.RUSTORE_PUSH_PROJECT_ID_CHILD || null;
    this.rustoreChildServiceToken = process.env.RUSTORE_PUSH_SERVICE_TOKEN_CHILD || null;
    this.rustoreParentProjectId = process.env.RUSTORE_PUSH_PROJECT_ID_PARENT || null;
    this.rustoreParentServiceToken = process.env.RUSTORE_PUSH_SERVICE_TOKEN_PARENT || null;
    if (this.rustoreChildProjectId && this.rustoreChildServiceToken) {
      this.logger.log(`RuStore Push (child) enabled project=${this.rustoreChildProjectId}`);
    } else {
      this.logger.warn(
        'RuStore Push (child) disabled — нет PROJECT_ID_CHILD / SERVICE_TOKEN_CHILD',
      );
    }
    if (this.rustoreParentProjectId && this.rustoreParentServiceToken) {
      this.logger.log(`RuStore Push (parent) enabled project=${this.rustoreParentProjectId}`);
    } else {
      this.logger.warn(
        'RuStore Push (parent) disabled — нет PROJECT_ID_PARENT / SERVICE_TOKEN_PARENT',
      );
    }
  }

  isEnabled(): boolean {
    return this.app !== null;
  }

  isRustoreEnabled(app: 'child' | 'parent'): boolean {
    return app === 'child'
      ? !!(this.rustoreChildProjectId && this.rustoreChildServiceToken)
      : !!(this.rustoreParentProjectId && this.rustoreParentServiceToken);
  }

  /**
   * v0.37: послать FCM data-message на child-устройство. Возвращает true если
   * FCM успешно принял, false иначе (caller продолжает с poll-fallback).
   *
   * UNREGISTERED / INVALID_ARGUMENT (token устарел) → автоматически очищаем
   * fcmToken в БД, чтобы дальнейшие отправки не тратили квоту.
   *
   * Для v0.51 hybrid send (FCM + RuStore) — используй sendHybridDataMessage.
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

  /**
   * v0.46: послать FCM data-message на произвольный токен (parent-device).
   * При expired/invalid token — `onInvalidToken(token)` колбэк.
   */
  async sendToToken(args: {
    fcmToken: string;
    data: Record<string, string>;
    onInvalidToken?: (token: string) => Promise<void>;
    label?: string;
  }): Promise<boolean> {
    if (!this.app) return false;
    const { fcmToken, data, onInvalidToken, label } = args;
    try {
      const msg = await admin.messaging(this.app).send({
        token: fcmToken,
        data,
        android: {
          priority: 'high',
          ttl: 300_000,
        },
      });
      this.logger.log(`FCM ${label ?? 'token'}: ${msg}`);
      return true;
    } catch (err) {
      const code = (err as { errorInfo?: { code?: string } } | null)?.errorInfo?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        this.logger.warn(`FCM token expired (${code}) — invoking cleanup`);
        if (onInvalidToken) {
          await onInvalidToken(fcmToken).catch(() => undefined);
        }
      } else {
        this.logger.error(`FCM ${label ?? 'token'} failed: ${String(err)}`);
      }
      return false;
    }
  }

  /**
   * v0.51: послать data-message через RuStore Push (VKPNS).
   *
   * Endpoint: POST https://vkpns.rustore.ru/v1/projects/{projectId}/messages:send
   * Auth: Bearer <service-token>. Body schema аналогичен FCM HTTP v1.
   *
   * 410 GONE / 404 → token устарел/неизвестен → колбэк onInvalidToken.
   * Другие 4xx/5xx → лог + false (caller продолжает fallback).
   *
   * `appKind` определяет какой набор credentials брать (child/parent app).
   */
  private async _sendRustoreMessage(args: {
    appKind: 'child' | 'parent';
    token: string;
    data: Record<string, string>;
    ttlSec: number;
    label: string;
    onInvalidToken?: (token: string) => Promise<void>;
  }): Promise<boolean> {
    const { appKind, token, data, ttlSec, label, onInvalidToken } = args;
    const projectId =
      appKind === 'child' ? this.rustoreChildProjectId : this.rustoreParentProjectId;
    const serviceToken =
      appKind === 'child' ? this.rustoreChildServiceToken : this.rustoreParentServiceToken;
    if (!projectId || !serviceToken) return false;

    const url = `https://vkpns.rustore.ru/v1/projects/${projectId}/messages:send`;
    const body = JSON.stringify({
      message: {
        token,
        data,
        android: {
          priority: 'HIGH',
          ttl: `${ttlSec}s`,
        },
      },
    });

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceToken}`,
        },
        body,
      });
      if (resp.ok) {
        this.logger.log(`RuStore ${appKind} ${label}: ${resp.status}`);
        return true;
      }
      const text = await resp.text().catch(() => '');
      // 404/410 в VKPNS — невалидный/отозванный token. Чистим в БД.
      if (resp.status === 404 || resp.status === 410) {
        this.logger.warn(
          `RuStore ${appKind} ${label} invalid token (${resp.status}) — invoking cleanup`,
        );
        if (onInvalidToken) {
          await onInvalidToken(token).catch(() => undefined);
        }
      } else {
        this.logger.error(
          `RuStore ${appKind} ${label} failed: HTTP ${resp.status} ${text.substring(0, 200)}`,
        );
      }
      return false;
    } catch (err) {
      this.logger.error(`RuStore ${appKind} ${label} network error: ${String(err)}`);
      return false;
    }
  }

  /**
   * v0.51 hybrid: послать child-устройству data-message через RuStore Push
   * (если есть rustorePushToken), fallback на FCM (если есть fcmToken).
   *
   * Возвращает true если хотя бы один канал принял сообщение. Невалидные
   * токены автоматически чистим в child_devices (RuStore 404/410 → null;
   * FCM token-not-registered → null).
   */
  async sendHybridDataMessage(
    deviceId: string,
    tokens: { fcmToken: string | null; rustorePushToken: string | null },
    data: Record<string, string>,
  ): Promise<boolean> {
    // 1. Если есть RuStore-токен — пробуем его первым (не сбрасывается MIUI).
    if (tokens.rustorePushToken && this.isRustoreEnabled('child')) {
      const ok = await this._sendRustoreMessage({
        appKind: 'child',
        token: tokens.rustorePushToken,
        data,
        ttlSec: 60,
        label: `device=${deviceId}`,
        onInvalidToken: async (t) => {
          await this.prisma.childDevice
            .updateMany({
              where: { rustorePushToken: t },
              data: { rustorePushToken: null, rustorePushTokenUpdatedAt: new Date() },
            })
            .catch(() => undefined);
        },
      });
      if (ok) return true;
      // Не доставлено через RuStore — пробуем FCM как fallback.
    }
    // 2. FCM fallback.
    return this.sendDataMessage(deviceId, tokens.fcmToken, data);
  }

  /**
   * v0.51 hybrid: послать parent-устройству data-message через RuStore Push +
   * FCM. См. sendHybridDataMessage для семантики каналов.
   *
   * `onInvalidFcmToken` / `onInvalidRustoreToken` — колбэки для очистки
   * соответствующих токенов в parent_devices.
   */
  async sendHybridToToken(args: {
    tokens: { fcmToken: string | null; rustorePushToken: string | null };
    data: Record<string, string>;
    onInvalidFcmToken?: (token: string) => Promise<void>;
    onInvalidRustoreToken?: (token: string) => Promise<void>;
    label?: string;
    ttlSec?: number;
  }): Promise<boolean> {
    const ttlSec = args.ttlSec ?? 300;
    const label = args.label ?? 'parent';
    if (args.tokens.rustorePushToken && this.isRustoreEnabled('parent')) {
      const ok = await this._sendRustoreMessage({
        appKind: 'parent',
        token: args.tokens.rustorePushToken,
        data: args.data,
        ttlSec,
        label,
        onInvalidToken: args.onInvalidRustoreToken,
      });
      if (ok) return true;
    }
    if (args.tokens.fcmToken) {
      return this.sendToToken({
        fcmToken: args.tokens.fcmToken,
        data: args.data,
        onInvalidToken: args.onInvalidFcmToken,
        label,
      });
    }
    return false;
  }
}
