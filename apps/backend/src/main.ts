import { initSentry } from './common/monitoring/sentry.init';
initSentry();
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // За Caddy reverse-proxy: доверяем X-Forwarded-For из docker-сети.
  // Без этого req.ip всегда будет docker-internal IP Caddy-контейнера, что
  // делает audit-log бесполезным для compliance/Роскомнадзора.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Backend listening on http://localhost:${port}`);
}

void bootstrap();
