import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WebSocket } from 'ws';
import { PrismaService } from '../prisma/prisma.service';

/**
 * v0.57: постоянный канал сервер → телефон ребёнка (WebSocket `/child/ws`).
 *
 * Зачем: FCM/RuStore Push зависят от внешних ключей и от того, как OEM
 * будит приложение; очередь DeviceCommand ребёнок забирает только вместе с
 * отправкой геолокации (в покое — раз в ~90с). Родительский «Звук вокруг»
 * ждёт ребёнка 45с, поэтому без push он не стартовал вовсе. Нативный
 * сервис геолокации на телефоне держит это соединение открытым, и команда
 * доходит за доли секунды.
 *
 * Сообщения — JSON-текст с полем `op` (как в audio-relay):
 *   сервер → ребёнок: {op:'push', id, data}  — тот же data-map, что уходит в FCM
 *                     {op:'ping'}           — раз в PING_INTERVAL_MS
 *   ребёнок → сервер: {op:'ack', id}         — push получен
 *                     {op:'pong'}
 *                     {op:'hello', appVersion, micReady?}
 *                     {op:'status', micReady}  — v0.62, смена готовности микрофона
 *
 * Push, подтверждённый ack'ом, с `data.commandId` помечает DeviceCommand
 * выполненной — иначе ближайший poll отдал бы ту же команду второй раз.
 */

/** Сколько ждём ack от телефона, прежде чем считать доставку неудачной. */
export const ACK_TIMEOUT_MS = 3_000;

interface Conn {
  ws: WebSocket;
  pending: Map<string, () => void>;
}

type ConnectedListener = (deviceId: string) => void;

@Injectable()
export class ChildRealtimeService {
  private readonly logger = new Logger(ChildRealtimeService.name);
  private readonly conns = new Map<string, Conn>();
  private readonly connectedListeners: ConnectedListener[] = [];

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Регистрирует сокет устройства. Предыдущее соединение того же устройства закрываем. */
  register(deviceId: string, ws: WebSocket): void {
    const prev = this.conns.get(deviceId);
    if (prev && prev.ws !== ws) {
      this.logger.log(`device=${deviceId}: replaced by new connection`);
      this.failPending(prev);
      try {
        prev.ws.close(4000, 'replaced');
      } catch {
        /* ignore */
      }
    }
    this.conns.set(deviceId, { ws, pending: new Map() });
    for (const cb of this.connectedListeners) {
      try {
        cb(deviceId);
      } catch (err) {
        this.logger.warn(`connected-listener failed: ${String(err)}`);
      }
    }
  }

  /**
   * Снимает регистрацию, только если это всё ещё актуальный сокет устройства.
   * `false` — сокет уже вытеснен новым соединением (или не был зарегистрирован).
   */
  unregister(deviceId: string, ws: WebSocket): boolean {
    const conn = this.conns.get(deviceId);
    if (!conn || conn.ws !== ws) return false;
    this.failPending(conn);
    this.conns.delete(deviceId);
    return true;
  }

  handleAck(deviceId: string, id: string): void {
    const resolve = this.conns.get(deviceId)?.pending.get(id);
    if (resolve) resolve();
  }

  isConnected(deviceId: string): boolean {
    const conn = this.conns.get(deviceId);
    return !!conn && conn.ws.readyState === conn.ws.OPEN;
  }

  connectedCount(): number {
    return this.conns.size;
  }

  /** Подписка на подключение устройства (досылка неисполненных команд). */
  onDeviceConnected(cb: ConnectedListener): void {
    this.connectedListeners.push(cb);
  }

  /**
   * Отправить data-message и дождаться ack. `false` — устройства нет на связи
   * или ack не пришёл за `timeoutMs` (сокет, скорее всего, мёртвый — рвём его,
   * телефон переподключится).
   */
  async sendWithAck(
    deviceId: string,
    data: Record<string, string>,
    timeoutMs = ACK_TIMEOUT_MS,
  ): Promise<boolean> {
    const conn = this.conns.get(deviceId);
    if (!conn || conn.ws.readyState !== conn.ws.OPEN) return false;

    const id = randomUUID();
    const startedAt = Date.now();
    const acked = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        resolve(false);
      }, timeoutMs);
      conn.pending.set(id, () => {
        clearTimeout(timer);
        conn.pending.delete(id);
        resolve(true);
      });
      try {
        conn.ws.send(JSON.stringify({ op: 'push', id, data }));
      } catch (err) {
        clearTimeout(timer);
        conn.pending.delete(id);
        this.logger.warn(`device=${deviceId}: send failed: ${String(err)}`);
        resolve(false);
      }
    });

    if (!acked) {
      this.logger.warn(
        `device=${deviceId}: ${data.type ?? '?'} not acked in ${timeoutMs}ms — dropping socket`,
      );
      try {
        conn.ws.terminate();
      } catch {
        /* ignore */
      }
      this.unregister(deviceId, conn.ws);
      return false;
    }

    this.logger.log(
      `device=${deviceId}: ${data.type ?? '?'} delivered in ${Date.now() - startedAt}ms`,
    );
    if (data.commandId) {
      await this.prisma.deviceCommand
        .updateMany({
          where: { id: data.commandId, childDeviceId: deviceId, status: 'pending' },
          data: { status: 'executed', executedAt: new Date() },
        })
        .catch((err) => this.logger.warn(`mark executed ${data.commandId}: ${String(err)}`));
    }
    return true;
  }

  private failPending(conn: Conn): void {
    // Висящие sendWithAck дождутся своего таймаута; тут просто не даём
    // ack'ам со старого сокета попасть в чужие ожидания.
    conn.pending.clear();
  }
}
