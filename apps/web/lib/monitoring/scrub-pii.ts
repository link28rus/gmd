import type { Event } from '@sentry/nextjs';

const BLOCKED_KEYS = new Set([
  'email',
  'phone',
  'password',
  'otp',
  'token',
  'refreshToken',
  'accessToken',
  'deviceToken',
  'dateOfBirth',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'childDeviceId',
  'childId',
]);

const PLACEHOLDER = '[Scrubbed]';
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function scrubDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (BLOCKED_KEYS.has(k)) {
      out[k] = PLACEHOLDER;
    } else {
      out[k] = scrubDeep(v);
    }
  }
  return out;
}

function scrubEmailsInString(s: string | undefined): string | undefined {
  if (!s) return s;
  return s.replace(EMAIL_RE, '[Scrubbed email]');
}

export function scrubPii(event: Event): Event {
  const result: Event = { ...event };

  if (event.request) {
    result.request = { ...event.request };
    if (event.request.data !== undefined) {
      result.request.data = scrubDeep(event.request.data);
    }
    if (event.request.headers) {
      result.request.headers = scrubDeep(event.request.headers) as Record<string, string>;
    }
  }

  if (event.extra) {
    result.extra = scrubDeep(event.extra) as Event['extra'];
  }

  if (event.contexts) {
    result.contexts = scrubDeep(event.contexts) as Event['contexts'];
  }

  if (event.breadcrumbs) {
    result.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      data: b.data ? (scrubDeep(b.data) as typeof b.data) : b.data,
    }));
  }

  if (event.exception?.values) {
    result.exception = {
      ...event.exception,
      values: event.exception.values.map((v) => ({
        ...v,
        value: scrubEmailsInString(v.value),
      })),
    };
  }

  return result;
}
