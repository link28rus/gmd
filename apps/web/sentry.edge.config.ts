import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN_WEB;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    sampleRate: 1.0,
    tracesSampleRate: 0,
  });
}
