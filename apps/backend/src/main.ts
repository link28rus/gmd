import { initSentry } from './common/monitoring/sentry.init';
initSentry();
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // v0.38: дефолт Express body-parser = 100KB, что мало для:
  //   - POST /child/app-icons — батч до 50 иконок × ~30KB base64 ≈ до 7MB
  //   - POST /child/usage-reports — до 24000 bucket'ов × ~80B ≈ до 2MB
  //   - POST /child/installed-apps — до 1000 apps × ~100B ≈ до 100KB
  // Ставим 10MB — с запасом, не критично для DoS защиты (есть throttle).
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  // За Caddy reverse-proxy: доверяем X-Forwarded-For из docker-сети.
  // Без этого req.ip всегда будет docker-internal IP Caddy-контейнера, что
  // делает audit-log бесполезным для compliance/Роскомнадзора.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  // WS-адаптер для AudioGateway (/audio/ws). Без этого NestJS попытается
  // поднять socket.io-сервер, и handshake провалится.
  app.useWebSocketAdapter(new WsAdapter(app));
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Backend listening on http://localhost:${port}`);
}

void bootstrap();
