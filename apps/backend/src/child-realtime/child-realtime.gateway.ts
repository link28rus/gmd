import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { ChildDeviceService } from '../child-device/child-device.service';
import { ChildRealtimeService } from './child-realtime.service';

// Пинг раз в 45с держит NAT-маппинг мобильного оператора и даёт телефону
// сигнал «соединение живое» (он переподключается, если пингов нет >105с).
// Молчащего дольше STALE_MS клиента считаем мёртвым и рвём.
const PING_INTERVAL_MS = 45_000;
const STALE_MS = 2 * PING_INTERVAL_MS + 15_000;

interface ConnState {
  deviceId: string;
  lastSeenAt: number;
}

const STATE = Symbol('child-realtime-state');
type WsWithState = WebSocket & { [STATE]?: ConnState };

/**
 * v0.57: WebSocket `/child/ws` (снаружи — `wss://<домен>/api/child/ws`, Caddy
 * срезает `/api`). Авторизация — тот же device-token, что в REST
 * (`X-Child-Token`). Логика доставки — в ChildRealtimeService.
 */
@WebSocketGateway({ path: '/child/ws' })
@Injectable()
export class ChildRealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(ChildRealtimeGateway.name);
  private readonly sockets = new Set<WsWithState>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ChildDeviceService) private readonly devices: ChildDeviceService,
    @Inject(ChildRealtimeService) private readonly realtime: ChildRealtimeService,
  ) {}

  afterInit(): void {
    this.pingTimer = setInterval(() => this.pingAll(), PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  async handleConnection(client: WsWithState, req: IncomingMessage): Promise<void> {
    const header = req.headers['x-child-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!token) return this.reject(client, 4401, 'missing_token');

    let deviceId: string;
    try {
      const ctx = await this.devices.verifyToken(token);
      if (!ctx) return this.reject(client, 4401, 'invalid_token');
      deviceId = ctx.deviceId;
    } catch (err) {
      this.logger.warn(`handleConnection verify failed: ${String(err)}`);
      return this.reject(client, 1011, 'auth_error');
    }
    if (client.readyState !== client.OPEN) return;

    client[STATE] = { deviceId, lastSeenAt: Date.now() };
    this.sockets.add(client);
    client.on('message', (data, isBinary) => {
      if (!isBinary) this.handleMessage(client, (data as Buffer).toString('utf-8'));
    });
    client.on('close', (code) => this.handleClose(client, code));
    client.on('error', (err) => {
      this.logger.warn(`device=${deviceId} socket error: ${err.message}`);
    });

    this.devices.touchLastSeen(deviceId);
    this.realtime.register(deviceId, client);
    this.send(client, { op: 'hello' });
    this.logger.log(`device=${deviceId} connected (online=${this.realtime.connectedCount()})`);
  }

  private handleMessage(client: WsWithState, text: string): void {
    const st = client[STATE];
    if (!st) return;
    st.lastSeenAt = Date.now();

    let msg: { op?: unknown; id?: unknown; appVersion?: unknown; micReady?: unknown };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    switch (msg.op) {
      case 'ack':
        if (typeof msg.id === 'string') this.realtime.handleAck(st.deviceId, msg.id);
        break;
      case 'pong':
        // Раз в пинг обновляем lastSeenAt — кабинет видит телефон «на связи»
        // даже в покое, когда геолокация уходит редко.
        this.devices.touchLastSeen(st.deviceId);
        break;
      case 'hello':
        if (typeof msg.appVersion === 'string' && msg.appVersion.length <= 32) {
          void this.devices.setAppVersion(st.deviceId, msg.appVersion);
        }
        this.applyMicReady(st.deviceId, msg.micReady);
        break;
      case 'status':
        // v0.62: телефон сообщает смену готовности микрофона сразу, не дожидаясь
        // переподключения. Не-boolean (старые/чужие клиенты) игнорируем.
        this.applyMicReady(st.deviceId, msg.micReady);
        break;
      default:
        break;
    }
  }

  private applyMicReady(deviceId: string, micReady: unknown): void {
    if (typeof micReady !== 'boolean') return;
    void this.devices.setMicReady(deviceId, micReady).then((changed) => {
      if (changed) this.logger.log(`device=${deviceId} micReady=${micReady}`);
    });
  }

  private handleClose(client: WsWithState, code: number): void {
    this.sockets.delete(client);
    const st = client[STATE];
    if (!st) return;
    const wasCurrent = this.realtime.unregister(st.deviceId, client);
    delete client[STATE];
    // Вытесненный сокет (телефон переподключился, например при смене сети)
    // закрывается позже, иногда по таймауту — это не обрыв связи с телефоном.
    this.logger.log(
      wasCurrent
        ? `device=${st.deviceId} disconnected code=${code}`
        : `device=${st.deviceId} replaced socket closed code=${code}`,
    );
  }

  private pingAll(): void {
    const now = Date.now();
    for (const client of this.sockets) {
      const st = client[STATE];
      if (!st) continue;
      if (now - st.lastSeenAt > STALE_MS) {
        this.logger.warn(`device=${st.deviceId} silent ${now - st.lastSeenAt}ms — terminating`);
        client.terminate();
        continue;
      }
      this.send(client, { op: 'ping' });
    }
  }

  private send(client: WebSocket, msg: Record<string, unknown>): void {
    try {
      client.send(JSON.stringify(msg));
    } catch {
      /* socket умер — разберётся close/pingAll */
    }
  }

  private reject(client: WebSocket, code: number, reason: string): void {
    try {
      client.close(code, reason);
    } catch {
      /* ignore */
    }
  }
}
