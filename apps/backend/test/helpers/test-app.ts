import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { execSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { FakeOtpProvider } from '../../src/auth/providers/fake-otp.provider';
import { OTP_DELIVERY } from '../../src/auth/providers/otp-delivery.provider';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestAppHandle {
  app: INestApplication;
  delivery: FakeOtpProvider;
  pg: StartedPostgreSqlContainer;
  redis: Redis;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export async function bootTestApp(): Promise<TestAppHandle> {
  // 1. Postgres testcontainer
  const pg = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  process.env.DATABASE_URL = pg.getConnectionUri();

  // 2. Prisma migrate deploy
  execSync('pnpm prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: pg.getConnectionUri() },
    stdio: 'inherit',
    cwd: join(__dirname, '..', '..'),
  });

  // 3. JWT keypair temp
  const dir = mkdtempSync(join(tmpdir(), 'gmd-e2e-jwt-'));
  const kp = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  writeFileSync(join(dir, 'p.pem'), kp.privateKey);
  writeFileSync(join(dir, 'pub.pem'), kp.publicKey);
  process.env.JWT_PRIVATE_KEY_PATH = join(dir, 'p.pem');
  process.env.JWT_PUBLIC_KEY_PATH = join(dir, 'pub.pem');
  process.env.ACCESS_TOKEN_TTL_SECONDS = '900';
  process.env.REFRESH_TOKEN_TTL_SECONDS = '60';
  process.env.OTP_TTL_SECONDS = '60';
  process.env.OTP_MAX_ATTEMPTS = '3';
  process.env.PRIVACY_POLICY_VERSION = '1.0';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:63790';

  // 4. Build AppModule с override OTP_DELIVERY
  const delivery = new FakeOtpProvider();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OTP_DELIVERY)
    .useValue(delivery)
    .compile();

  const app = module.createNestApplication();
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  const redis = new Redis(process.env.REDIS_URL);
  const prisma = app.get(PrismaService);

  return {
    app,
    delivery,
    pg,
    redis,
    prisma,
    async close() {
      await app.close();
      redis.disconnect();
      await pg.stop();
    },
  };
}

export async function truncateAll(h: TestAppHandle): Promise<void> {
  await h.prisma.$executeRawUnsafe(
    'TRUNCATE TABLE zone_events, zone_states, zone_child_assignments, zones, sos_events, locations, consent_records, child_devices, invites, children, refresh_tokens, otp_codes, memberships, families, users RESTART IDENTITY CASCADE;',
  );
  await h.redis.flushdb();
  h.delivery.reset();
}
