import type { Event, EventHint } from '@sentry/node';
import { HttpException } from '@nestjs/common';
import { shouldSendEvent } from './sentry.init';

describe('shouldSendEvent (4xx filter)', () => {
  function mkHint(exception: unknown): EventHint {
    return { originalException: exception };
  }

  it('не шлёт UnauthorizedException', () => {
    const err = new HttpException('Unauthorized', 401);
    err.name = 'UnauthorizedException';
    expect(shouldSendEvent({} as Event, mkHint(err))).toBe(false);
  });

  it('не шлёт BadRequestException', () => {
    const err = new HttpException('Bad', 400);
    err.name = 'BadRequestException';
    expect(shouldSendEvent({} as Event, mkHint(err))).toBe(false);
  });

  it('не шлёт ThrottlerException', () => {
    const err = new Error('Too many');
    err.name = 'ThrottlerException';
    expect(shouldSendEvent({} as Event, mkHint(err))).toBe(false);
  });

  it('шлёт InternalServerErrorException (5xx)', () => {
    const err = new HttpException('Boom', 500);
    err.name = 'InternalServerErrorException';
    expect(shouldSendEvent({} as Event, mkHint(err))).toBe(true);
  });

  it('шлёт необработанный Error без name из блоклиста', () => {
    const err = new TypeError('x is not a function');
    expect(shouldSendEvent({} as Event, mkHint(err))).toBe(true);
  });

  it('шлёт когда нет originalException', () => {
    expect(shouldSendEvent({} as Event, {})).toBe(true);
  });
});
