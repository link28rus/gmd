import type { Event } from '@sentry/nextjs';
import { scrubPii } from './scrub-pii';

describe('scrubPii (web)', () => {
  it('вычищает email из request.data', () => {
    const event: Event = { request: { data: { email: 'u@e.com', foo: 'bar' } } };
    const scrubbed = scrubPii(event);
    expect(scrubbed.request?.data).toEqual({ email: '[Scrubbed]', foo: 'bar' });
  });

  it('вычищает lat/lng из extra', () => {
    const event: Event = { extra: { lat: 55, lng: 37, user: 'Ivan' } };
    const scrubbed = scrubPii(event);
    expect(scrubbed.extra).toEqual({
      lat: '[Scrubbed]',
      lng: '[Scrubbed]',
      user: 'Ivan',
    });
  });

  it('не мутирует вход', () => {
    const event: Event = { extra: { email: 'u@e.com' } };
    const scrubbed = scrubPii(event);
    expect(event.extra).toEqual({ email: 'u@e.com' });
    expect(scrubbed).not.toBe(event);
  });

  it('вычищает email из exception.value', () => {
    const event: Event = {
      exception: {
        values: [{ type: 'Error', value: 'failed to send to admin@example.com' }],
      },
    };
    const scrubbed = scrubPii(event);
    expect(scrubbed.exception?.values?.[0].value).toContain('[Scrubbed email]');
  });
});
