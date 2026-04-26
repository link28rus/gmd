import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import type { WebSocket, WebSocketServer as WsServer } from 'ws';
import { AudioRelay } from './audio.relay';
import { AudioTokenService, type AudioWsClaims } from './audio-token.service';
import { AudioService } from './audio.service';
import type { AudioWsControlMessage, AudioWsHello } from './dto/audio-ws.dto';

// 60s — частота watchdog-сканирования. Глобальный idle-порог 180s — должен быть
// >= audio.child_ready_timeout_sec (по умолчанию 180s), чтобы PENDING-сессии
// добивались expireIfStuck'ом БЕЗ enqueueAudioStop, а не watchdog'ом, который
// enqueue'ит STOP_AUDIO и порождает race START+STOP в command queue для child'а
// (см. v0.36.0-rc.2 fix в device-commands.service.ts listPending).
const WATCHDOG_INTERVAL_MS = 60_000;
const SESSION_IDLE_TIMEOUT_MS = 180_000;

interface WsContext {
  sessionId: string;
  role: 'child' | 'parent';
  sub: string;
}

const CTX = Symbol('audio-ws-ctx');
type WsWithCtx = WebSocket & { [CTX]?: WsContext };

@WebSocketGateway({ path: '/audio/ws' })
@Injectable()
export class AudioGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(AudioGateway.name);
  @WebSocketServer() server!: WsServer;
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(AudioRelay) private readonly relay: AudioRelay,
    @Inject(AudioTokenService) private readonly tokens: AudioTokenService,
    @Inject(AudioService) private readonly audio: AudioService,
  ) {}

  afterInit(): void {
    this.relay.setCallbacks({
      onActivate: (sid) =>
        this.audio.activateBySessionId(sid).catch((err) => {
          this.logger.warn(`activate(${sid}) failed: ${String(err)}`);
        }),
      onIdleExpire: (sid) =>
        this.audio.expireOrFail(sid, 'EXPIRED', 'NETWORK_ERROR').catch((err) => {
          this.logger.warn(`expireOrFail(${sid}) failed: ${String(err)}`);
        }),
    });

    // Watchdog: раз в минуту смотрим, нет ли сессий без фреймов > 90с.
    // Закрываем сокеты + помечаем сессию EXPIRED в БД. .unref() чтобы не держать
    // event loop при graceful shutdown.
    this.watchdogTimer = setInterval(() => {
      const stuck = this.relay.findIdleSessions(SESSION_IDLE_TIMEOUT_MS);
      for (const sid of stuck) {
        this.logger.warn(`session ${sid}: idle > ${SESSION_IDLE_TIMEOUT_MS}ms, terminating`);
        this.relay.terminate(sid, 4006, 'idle_timeout');
        void this.audio.expireOrFail(sid, 'EXPIRED', 'NETWORK_ERROR').catch((err) => {
          this.logger.warn(`watchdog expireOrFail(${sid}): ${String(err)}`);
        });
      }
    }, WATCHDOG_INTERVAL_MS);
    this.watchdogTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  async handleConnection(client: WsWithCtx, req: IncomingMessage): Promise<void> {
    let ctx: WsContext | null = null;
    try {
      const url = new URL(req.url ?? '', 'ws://placeholder');
      const role = url.searchParams.get('role');
      const sessionId = url.searchParams.get('sessionId');
      const token = url.searchParams.get('token');

      if (!role || !sessionId || !token) {
        return this.rejectClient(client, 4400, 'missing_query_params');
      }
      if (role !== 'child' && role !== 'parent') {
        return this.rejectClient(client, 4400, 'invalid_role');
      }

      const claims: AudioWsClaims | null = await this.tokens.verify(token);
      if (!claims) {
        return this.rejectClient(client, 4401, 'invalid_token');
      }
      if (claims.sid !== sessionId || claims.role !== role) {
        return this.rejectClient(client, 4401, 'token_session_mismatch');
      }

      const session = await this.audio.validateSessionForWs(sessionId, role, claims.sub);
      if (!session) {
        return this.rejectClient(client, 4404, 'session_not_active');
      }

      ctx = { sessionId, role, sub: claims.sub };
      client[CTX] = ctx;

      if (role === 'child') {
        this.relay.attachProducer(sessionId, client);
      } else {
        this.relay.attachConsumer(sessionId, client);
      }

      const hello: AudioWsHello = {
        op: 'hello',
        sessionId,
        role,
        durationSec: session.durationSec,
      };
      this.sendControl(client, hello);

      client.on('message', (data, isBinary) => {
        this.handleMessage(client, ctx as WsContext, data as Buffer, isBinary);
      });
      client.on('close', () => this.handleClose(client));
      client.on('error', (err) => {
        this.logger.warn(`session ${ctx?.sessionId} ${ctx?.role} socket error: ${err.message}`);
      });

      this.logger.log(`session ${sessionId} ${role} connected (sub=${claims.sub})`);
    } catch (err) {
      this.logger.warn(`handleConnection failed: ${String(err)}`);
      this.rejectClient(client, 4401, 'auth_failed');
    }
  }

  /**
   * Required by OnGatewayDisconnect, но реальная очистка делается в 'close' listener
   * выше — там у нас доступен ctx. handleDisconnect вызывается AFTER 'close',
   * поэтому ctx уже мог быть очищен; на всякий случай повторяем detach.
   */
  handleDisconnect(client: WsWithCtx): void {
    this.handleClose(client);
  }

  private handleMessage(client: WsWithCtx, ctx: WsContext, data: Buffer, isBinary: boolean): void {
    if (isBinary) {
      // Только child может публиковать аудио. Parent отправивший binary → закрываем.
      if (ctx.role !== 'child') {
        this.logger.warn(`session ${ctx.sessionId} parent sent binary, closing`);
        try {
          client.close(4008, 'binary_from_consumer');
        } catch {
          /* ignore */
        }
        return;
      }
      this.relay.publishFrame(ctx.sessionId, data);
      return;
    }

    // Text-фрейм — control message JSON. Сейчас обрабатываем только error от child'а.
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString('utf-8'));
    } catch {
      this.logger.debug(`session ${ctx.sessionId} ${ctx.role}: bad JSON control`);
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const msg = parsed as Partial<AudioWsControlMessage>;
    if (msg.op === 'error' && ctx.role === 'child') {
      const code = msg.code ?? 'UNKNOWN';
      const message = msg.message;
      this.logger.warn(
        `session ${ctx.sessionId}: child error code=${code} message=${message ?? ''}`,
      );
      void this.audio
        .markChildError({ sessionId: ctx.sessionId, deviceId: ctx.sub, code, message })
        .catch((err) =>
          this.logger.warn(`markChildError(${ctx.sessionId}) failed: ${String(err)}`),
        );
    }
    // 'bye' от parent'а можно реализовать post-MVP (graceful stop) — сейчас он шлёт HTTP /stop.
  }

  private handleClose(client: WsWithCtx): void {
    const ctx = client[CTX];
    if (!ctx) return;
    this.relay.detach(ctx.sessionId, client);
    delete client[CTX];
    this.logger.log(`session ${ctx.sessionId} ${ctx.role} disconnected (sub=${ctx.sub})`);
  }

  private sendControl(client: WebSocket, msg: AudioWsControlMessage): void {
    try {
      client.send(JSON.stringify(msg));
    } catch (err) {
      this.logger.debug(`sendControl failed: ${String(err)}`);
    }
  }

  private rejectClient(client: WebSocket, code: number, reason: string): void {
    try {
      client.close(code, reason);
    } catch {
      /* ignore */
    }
  }
}
