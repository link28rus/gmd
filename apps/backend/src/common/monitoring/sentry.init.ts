import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Sentry from '@sentry/node';
import type { ErrorEvent, Event, EventHint } from '@sentry/node';
import { scrubPii } from './scrub-pii';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as {
  version: string;
};

const FILTERED_EXCEPTION_NAMES = new Set([
  'UnauthorizedException',
  'BadRequestException',
  'ForbiddenException',
  'NotFoundException',
  'ThrottlerException',
  'ValidationError',
  'ZodError',
  'ConflictException',
]);

export function shouldSendEvent(_event: Event, hint: EventHint | undefined): boolean {
  const exc = hint?.originalException;
  if (!exc) return true;
  const name =
    (exc as { name?: string })?.name ??
    (exc as { constructor?: { name?: string } })?.constructor?.name ??
    '';
  return !FILTERED_EXCEPTION_NAMES.has(name);
}

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN_BACKEND;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.APP_VERSION ?? pkg.version,
    sampleRate: 1.0,
    tracesSampleRate: 0,
    beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
      if (!shouldSendEvent(event, hint)) return null;
      return scrubPii(event) as ErrorEvent;
    },
  });
}
