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
    const code = String(randomInt(100000, 1000000));
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

    const match = await argonVerify(row.codeHash, code);
    if (!match) {
      const nextAttempts = row.attempts + 1;
      if (nextAttempts >= this.cfg.maxAttempts) {
        await this.prisma.otpCode.update({
          where: { id: row.id },
          data: { attempts: nextAttempts, consumedAt: new Date() },
        });
      } else {
        await this.prisma.otpCode.update({
          where: { id: row.id },
          data: { attempts: nextAttempts },
        });
      }
      return { ok: false, reason: 'invalid_code' };
    }

    await this.prisma.otpCode.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    return { ok: true, otpId: row.id };
  }
}
