import type { Event } from '@sentry/node';
import { scrubPii } from './scrub-pii';

describe('scrubPii', () => {
  it('вычищает email из request.data', () => {
    const event: Event = {
      request: { data: { email: 'user@example.com', foo: 'bar' } },
    };
    const scrubbed = scrubPii(event);
    expect(scrubbed.request?.data).toEqual({
      email: '[Scrubbed]',
      foo: 'bar',
    });
  });

  it('вычищает все блок-поля из extra', () => {
    const event: Event = {
      extra: {
        phone: '+79991234567',
        password: 'secret',
        otp: '1234',
        token: 'jwt…',
        refreshToken: 'rt…',
        accessToken: 'at…',
        deviceToken: 'dt…',
        dateOfBirth: '2020-01-01',
        lat: 55.0,
        lng: 37.0,
        latitude: 55.0,
        longitude: 37.0,
        childDeviceId: 'cuid…',
        childId: 'cuid…',
        safe: 'keep',
      },
    };
    const scrubbed = scrubPii(event);
    expect(scrubbed.extra?.safe).toBe('keep');
    for (const key of [
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
    ]) {
      expect(scrubbed.extra?.[key]).toBe('[Scrubbed]');
    }
  });

  it('вычищает вложенные объекты', () => {
    const event: Event = {
      extra: { user: { email: 'u@e.com', name: 'Ivan' } },
    };
    const scrubbed = scrubPii(event);
    const user = scrubbed.extra?.user as Record<string, unknown>;
    expect(user.email).toBe('[Scrubbed]');
    expect(user.name).toBe('Ivan');
  });

  it('вычищает поля в breadcrumbs[].data', () => {
    const event: Event = {
      breadcrumbs: [{ message: 'click', data: { email: 'u@e.com' } }],
    };
    const scrubbed = scrubPii(event);
    expect(scrubbed.breadcrumbs?.[0].data?.email).toBe('[Scrubbed]');
  });

  it('вычищает email-like строки из exception.value', () => {
    const event: Event = {
      exception: {
        values: [{ type: 'Error', value: 'failed to send to user@example.com' }],
      },
    };
    const scrubbed = scrubPii(event);
    expect(scrubbed.exception?.values?.[0].value).not.toContain('user@example.com');
    expect(scrubbed.exception?.values?.[0].value).toContain('[Scrubbed email]');
  });

  it('не падает на event без полей', () => {
    const event: Event = {};
    expect(() => scrubPii(event)).not.toThrow();
  });

  it('возвращает копию, не мутирует вход', () => {
    const event: Event = { request: { data: { email: 'u@e.com' } } };
    const scrubbed = scrubPii(event);
    expect(event.request?.data).toEqual({ email: 'u@e.com' }); // оригинал не тронут
    expect(scrubbed).not.toBe(event);
  });
});
