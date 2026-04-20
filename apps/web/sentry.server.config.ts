import * as Sentry from '@sentry/nextjs';
import { scrubPii } from './lib/monitoring/scrub-pii';

const FILTERED = new Set(['UnauthorizedError', 'NotFoundError', 'ForbiddenError']);

const dsn = process.env.SENTRY_DSN_WEB;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION,
    sampleRate: 1.0,
    tracesSampleRate: 0,
    beforeSend(event, hint) {
      const name = (hint?.originalException as { name?: string })?.name ?? '';
      if (FILTERED.has(name)) return null;
      return scrubPii(event) as typeof event;
    },
  });
}
