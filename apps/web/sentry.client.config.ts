import * as Sentry from '@sentry/nextjs';
import { scrubPii } from './lib/monitoring/scrub-pii';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_NODE_ENV ?? 'production',
    tunnel: '/api/sentry-tunnel',
    sampleRate: 1.0,
    tracesSampleRate: 0,
    beforeSend(event) {
      return scrubPii(event) as typeof event;
    },
  });
}
