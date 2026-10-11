import { Inject, Injectable } from '@nestjs/common';
import { hash, verify as argonVerify } from '@node-rs/argon2';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface OtpConfig {
  ttlSec: number;
  maxAttempts: number;
}

export const OTP_CONFIG = Symbol('OTP_CONFIG');

export type VerifyResult =
  | { ok: true; otpId: string }
  | { ok: false; reason: 'invalid_code' | 'code_expired' | 'code_consumed' };

@Injectable()
export class OtpService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OTP_CONFIG) private readonly cfg: OtpConfig,
  ) {}

  async generate(email: string): Promise<{ code: string; otpId: string }> {
    await this.prisma.otpCode.updateMany({
      where: { email, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const fixed = process.env.NODE_ENV === 'production' ? undefined : process.env.OTP_FIXED_DEV;
    const code = fixed && /^\d{6}$/.test(fixed) ? fixed : String(randomInt(100000, 1000000));
    const codeHash = await hash(code);
    const expiresAt = new Date(Date.now() + this.cfg.ttlSec * 1000);
    const row = await this.prisma.otpCode.create({
      data: { email, codeHash, expiresAt, purpose: 'login' },
    });
    return { code, otpId: row.id };
  }

  async verify(email: string, code: string): Promise<VerifyResult> {
    const row = await this.prisma.otpCode.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return { ok: false, reason: 'invalid_code' };

    // Попытка засчитывается ДО проверки хеша и атомарно: параллельные
    // угадывания не прочитают одно и то же значение attempts. Лимит исчерпан
    // (или код уже погашен соседним запросом) — count 0.
    const charged = await this.prisma.otpCode.updateMany({
      where: { id: row.id, consumedAt: null, attempts: { lt: this.cfg.maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (charged.count !== 1) return { ok: false, reason: 'invalid_code' };

    const match = await argonVerify(row.codeHash, code);
    if (!match) {
      // Последняя попытка израсходована — гасим код.
      await this.prisma.otpCode.updateMany({
        where: { id: row.id, consumedAt: null, attempts: { gte: this.cfg.maxAttempts } },
        data: { consumedAt: new Date() },
      });
      return { ok: false, reason: 'invalid_code' };
    }

    // Гасим атомарно: верный код, поданный дважды параллельно, сработает один раз.
    const consumed = await this.prisma.otpCode.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) return { ok: false, reason: 'invalid_code' };
    return { ok: true, otpId: row.id };
  }
}
