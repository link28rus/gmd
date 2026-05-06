import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface RefreshTokenConfig {
  ttlSec: number;
}

export const REFRESH_TOKEN_CONFIG = Symbol('REFRESH_TOKEN_CONFIG');

export interface TokenMeta {
  userAgent?: string;
  ipAddress?: string;
}

export type RotateResult =
  | { ok: true; token: string; userId: string }
  | { ok: false; replay?: boolean };

// Grace-окно: если уже отозванный refresh-token подаётся повторно в течение
// этого интервала после ротации, считаем это race condition (две вкладки/
// клиента дёрнули refresh с одним cookie до того как браузер обновил Set-Cookie),
// а не replay-attack. Возвращаем ok:false без revoke-all — пострадавший
// клиент в следующий тик отправит уже новый cookie.
const RACE_GRACE_MS = 10_000;

function sha256(v: string): string {
  return createHash('sha256').update(v).digest('hex');
}

@Injectable()
export class RefreshTokenService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REFRESH_TOKEN_CONFIG) private readonly cfg: RefreshTokenConfig,
  ) {}

  async create(userId: string, meta: TokenMeta): Promise<{ token: string; id: string }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + this.cfg.ttlSec * 1000);
    const row = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt,
      },
    });
    return { token, id: row.id };
  }

  async rotate(oldToken: string, meta: TokenMeta): Promise<RotateResult> {
    const tokenHash = sha256(oldToken);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row) return { ok: false };

    // Replay: клиент использовал уже отозванный/ротированный токен
    if (row.revokedAt !== null) {
      if (row.rotatedToId !== null) {
        // Race vs replay: при параллельных refresh из нескольких вкладок одна
        // выигрывает, остальные приходят со старым токеном через миллисекунды.
        // В пределах RACE_GRACE_MS НЕ revoke-all — иначе все активные вкладки
        // разлогиниваются. Реальный replay (минуты/часы спустя) ловим как раньше.
        const sinceRevokeMs = Date.now() - row.revokedAt.getTime();
        if (sinceRevokeMs <= RACE_GRACE_MS) {
          return { ok: false };
        }
        await this.prisma.refreshToken.updateMany({
          where: { userId: row.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return { ok: false, replay: true };
      }
      return { ok: false };
    }

    if (row.expiresAt <= new Date()) return { ok: false };

    const { token: newToken, id: newId } = await this.create(row.userId, meta);
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), rotatedToId: newId },
    });
    return { ok: true, token: newToken, userId: row.userId };
  }

  async revoke(token: string): Promise<void> {
    const tokenHash = sha256(token);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.revokedAt !== null) return;
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
