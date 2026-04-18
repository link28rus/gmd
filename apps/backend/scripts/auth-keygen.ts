/**
 * Генерирует RS256 keypair для JWT access-токенов.
 * Private → apps/backend/.secrets/jwt-private.pem (gitignored)
 * Public  → apps/backend/.secrets/jwt-public.pem
 *
 * Prod: ключи кладутся руками в /opt/gmd/secrets/ и путь в .env.prod.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, '..', '.secrets');
const PRIVATE_PATH = join(DIR, 'jwt-private.pem');
const PUBLIC_PATH = join(DIR, 'jwt-public.pem');

if (existsSync(PRIVATE_PATH) && !process.argv.includes('--force')) {
  console.error(`Keys already exist at ${PRIVATE_PATH}. Re-run with --force to overwrite.`);
  process.exit(1);
}

mkdirSync(DIR, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(PRIVATE_PATH, privateKey, { mode: 0o600 });
writeFileSync(PUBLIC_PATH, publicKey, { mode: 0o644 });

console.log(`Generated RS256 keypair:\n  ${PRIVATE_PATH}\n  ${PUBLIC_PATH}`);
