import type { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { getStorageToken } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import { FakeOtpProvider } from '../../src/auth/providers/fake-otp.provider';
import { OTP_DELIVERY } from '../../src/auth/providers/otp-delivery.provider';
import { MailerService } from '../../src/mailer/mailer.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { FakeMailer } from './fake-mailer';

export interface TestAppHandle {
  app: INestApplication;
  delivery: FakeOtpProvider;
  mailer: FakeMailer;
  pg: StartedPostgreSqlContainer;
  redis: Redis;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export async function bootTestApp(): Promise<TestAppHandle> {
  // 1. Postgres testcontainer
  const pg = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  process.env.DATABASE_URL = pg.getConnectionUri();

  // 2. Prisma migrate deploy — CLI prisma запускаем тем же node напрямую,
  // без pnpm/npx: на Windows execSync идёт через cmd, где pnpm не в PATH.
  const backendDir = join(__dirname, '..', '..');
  execFileSync(
    process.execPath,
    [require.resolve('prisma/build/index.js', { paths: [backendDir] }), 'migrate', 'deploy'],
    {
      env: { ...process.env, DATABASE_URL: pg.getConnectionUri() },
      stdio: 'inherit',
      cwd: backendDir,
    },
  );

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
  const mailer = new FakeMailer();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OTP_DELIVERY)
    .useValue(delivery)
    .overrideProvider(MailerService)
    .useValue(mailer)
    .compile();

  const app = module.createNestApplication();
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  // Как в src/main.ts: без WS-адаптера Nest ищет socket.io и роняет init
  // (registerWsModule → process.exit) на шлюзах ребёнка и аудио.
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.init();

  const redis = new Redis(process.env.REDIS_URL);
  const prisma = app.get(PrismaService);
  // Клиент Redis хранилища троттлера создаётся в app.module и при
  // app.close() не закрывается — открытый сокет не даёт jest завершиться.
  const throttlerRedis = (app.get(getStorageToken()) as unknown as { redis?: Redis }).redis;

  return {
    app,
    delivery,
    mailer,
    pg,
    redis,
    prisma,
    async close() {
      await app.close();
      throttlerRedis?.disconnect();
      redis.disconnect();
      await pg.stop();
    },
  };
}

export async function truncateAll(h: TestAppHandle): Promise<void> {
  // Приём точек запускает пересчёт поездок в фоне (fire-and-forget); если он
  // ещё идёт от прошлого теста, TRUNCATE ловит deadlock (40P01) — повторяем.
  for (let attempt = 1; ; attempt++) {
    try {
      await h.prisma.$executeRawUnsafe(
        'TRUNCATE TABLE zone_events, zone_states, zone_child_assignments, zones, sos_events, locations, consent_records, child_devices, invites, children, refresh_tokens, otp_codes, memberships, families, users RESTART IDENTITY CASCADE;',
      );
      break;
    } catch (e) {
      if (attempt >= 5 || !String(e).includes('40P01')) throw e;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  await h.redis.flushdb();
  h.delivery.reset();
  h.mailer.reset();
}

/**
 * Регистрирует родителя и подтверждает email по ссылке из письма — после
 * этого вход по OTP (`request-otp` → `verify-otp`) работает. С v0.21
 * `request-otp` отвечает 404 для незарегистрированной почты.
 */
export async function registerVerifiedUser(
  h: TestAppHandle,
  email: string,
): Promise<{ accessToken: string; refreshToken: string; userId: string; familyId: string }> {
  const server = h.app.getHttpServer();
  await request(server)
    .post('/auth/register')
    .send({
      email,
      password: 'test-password-1',
      passwordConfirm: 'test-password-1',
      firstName: 'Тест',
      lastName: 'Родитель',
    })
    .expect(202);
  const token = h.mailer.lastTokenFor(email.toLowerCase());
  if (!token) throw new Error(`no confirmation mail for ${email}`);
  const r = await request(server).post('/auth/confirm-email').send({ token }).expect(200);
  return {
    accessToken: r.body.accessToken,
    refreshToken: r.body.refreshToken,
    userId: r.body.user.id,
    familyId: r.body.family.id,
  };
}
