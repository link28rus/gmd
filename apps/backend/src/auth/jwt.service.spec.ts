import { JwtService } from './jwt.service';
import type { JwtPayload } from './jwt.service';
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setupKeys(): { privPath: string; pubPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gmd-jwt-'));
  const kp = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const privPath = join(dir, 'p.pem');
  const pubPath = join(dir, 'pub.pem');
  writeFileSync(privPath, kp.privateKey);
  writeFileSync(pubPath, kp.publicKey);
  return { privPath, pubPath };
}

describe('JwtService', () => {
  const keys = setupKeys();
  const cfg = {
    privateKeyPath: keys.privPath,
    publicKeyPath: keys.pubPath,
    accessTtlSec: 900,
  };
  const svc = new JwtService(cfg);

  beforeAll(async () => {
    await svc.onModuleInit();
  });

  const payload: JwtPayload = {
    sub: 'user-1',
    familyId: 'fam-1',
    role: 'owner',
  };

  it('signAccessToken возвращает строку формата JWT', async () => {
    const token = await svc.signAccessToken(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  it('verify возвращает те же claims', async () => {
    const token = await svc.signAccessToken(payload);
    const decoded = await svc.verifyAccessToken(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.familyId).toBe('fam-1');
    expect(decoded.role).toBe('owner');
  });

  it('verify бросает на tampered token', async () => {
    const token = await svc.signAccessToken(payload);
    const bad = token.slice(0, -2) + 'XX';
    await expect(svc.verifyAccessToken(bad)).rejects.toThrow();
  });

  it('verify бросает на expired token (c учётом clock skew)', async () => {
    // accessTtlSec=-60 создаёт token который истёк минуту назад, clockTolerance=30s — всё равно expired
    const shortSvc = new JwtService({ ...cfg, accessTtlSec: -60 });
    await shortSvc.onModuleInit();
    const token = await shortSvc.signAccessToken(payload);
    await expect(shortSvc.verifyAccessToken(token)).rejects.toThrow();
  });
});
