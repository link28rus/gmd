import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'enc:v1:';

/**
 * Шифрование значений, которые хранятся в БД (SMTP_PASS и др.).
 * Ключ берётся из env SMTP_SECRET_KEY. Допускается 32-байтовый hex (64 символа)
 * или произвольная строка — в последнем случае берётся SHA-256 от строки.
 *
 * Формат в БД: `enc:v1:<base64(iv || ciphertext || tag)>`.
 */
@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);
  private readonly key: Buffer | null;

  constructor() {
    const raw = process.env.SMTP_SECRET_KEY ?? '';
    if (!raw) {
      this.key = null;
      this.logger.warn('SMTP_SECRET_KEY is not set — secret values will be stored in plain text');
      return;
    }
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      this.key = Buffer.from(raw, 'hex');
    } else {
      this.key = createHash('sha256').update(raw, 'utf8').digest();
    }
  }

  isConfigured(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) return plaintext;
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, ct, tag]);
    return PREFIX + packed.toString('base64');
  }

  decrypt(value: string): string {
    if (!value.startsWith(PREFIX)) return value;
    if (!this.key) {
      throw new Error('SMTP_SECRET_KEY is not configured, cannot decrypt stored secret');
    }
    const packed = Buffer.from(value.slice(PREFIX.length), 'base64');
    if (packed.length < IV_LEN + TAG_LEN) {
      throw new Error('Encrypted value is malformed');
    }
    const iv = packed.subarray(0, IV_LEN);
    const tag = packed.subarray(packed.length - TAG_LEN);
    const ct = packed.subarray(IV_LEN, packed.length - TAG_LEN);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
  }
}
