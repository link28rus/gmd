import { Injectable, Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

export type AudioWsRole = 'child' | 'parent';

export interface AudioWsClaims {
  /** sessionId аудио-сессии (cuid) */
  sid: string;
  /** Роль клиента в relay */
  role: AudioWsRole;
  /** Subject — childDeviceId для role=child, userId для role=parent */
  sub: string;
  iat: number;
  exp: number;
}

export interface IssueParams {
  sessionId: string;
  role: AudioWsRole;
  sub: string;
  ttlSec: number;
}

/**
 * JWT для авторизации WebSocket подключений к /audio/ws.
 *
 * Алгоритм: HS256 с симметричным AUDIO_WS_SECRET (env). Backend и сам же
 * валидирует — ассиметричные ключи overkill для in-process verify.
 *
 * Почему отдельный secret (не reuse сессионных JWT): чтобы у токена была
 * минимальная роль — только «подключиться к этой одной сессии», без доступа
 * к остальным API. Token живёт ~ttlSec (= readyTimeout + duration + buffer),
 * после ENDED/FAILED больше не валиден на стороне сервера (validateSessionForWs).
 */
@Injectable()
export class AudioTokenService {
  private readonly logger = new Logger(AudioTokenService.name);
  private secretKey: Uint8Array | null = null;

  private getSecret(): Uint8Array {
    if (!this.secretKey) {
      const raw = process.env.AUDIO_WS_SECRET;
      if (!raw || raw.length < 32) {
        throw new Error(
          'AUDIO_WS_SECRET env variable must be set (>= 32 chars). ' +
            'Generate with: openssl rand -base64 48',
        );
      }
      this.secretKey = new TextEncoder().encode(raw);
    }
    return this.secretKey;
  }

  async issue(p: IssueParams): Promise<string> {
    return new SignJWT({ sid: p.sessionId, role: p.role, sub: p.sub })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(`${p.ttlSec}s`)
      .sign(this.getSecret());
  }

  async verify(token: string): Promise<AudioWsClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.getSecret(), { algorithms: ['HS256'] });
      const sid = payload.sid;
      const role = payload.role;
      const sub = payload.sub;
      if (typeof sid !== 'string' || typeof sub !== 'string') return null;
      if (role !== 'child' && role !== 'parent') return null;
      return {
        sid,
        role,
        sub,
        iat: typeof payload.iat === 'number' ? payload.iat : 0,
        exp: typeof payload.exp === 'number' ? payload.exp : 0,
      };
    } catch (err) {
      this.logger.debug(`WS token verify failed: ${String(err)}`);
      return null;
    }
  }
}
