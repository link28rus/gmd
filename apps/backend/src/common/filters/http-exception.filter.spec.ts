/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function mockHost(url = '/test'): {
  switchToHttp: () => { getResponse: () => unknown; getRequest: () => unknown };
  res: { status: jest.Mock; json: jest.Mock };
  req: { url: string };
} {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const req = { url };
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
    res,
    req,
  };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('оборачивает HttpException в унифицированный формат', () => {
    const host = mockHost();
    const exc = new HttpException({ code: 'forbidden', message: 'nope' }, HttpStatus.FORBIDDEN);

    filter.catch(exc, host as any);

    expect(host.res.status).toHaveBeenCalledWith(403);
    expect(host.res.json).toHaveBeenCalledWith({
      error: { code: 'forbidden', message: 'nope' },
    });
  });

  it('для строкового HttpException использует дефолтный code', () => {
    const host = mockHost();
    const exc = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);

    filter.catch(exc, host as any);

    expect(host.res.status).toHaveBeenCalledWith(400);
    expect(host.res.json).toHaveBeenCalledWith({
      error: { code: 'bad_request', message: 'Bad Request' },
    });
  });

  it('неизвестная ошибка → 500 с кодом internal_error', () => {
    const host = mockHost();
    filter.catch(new Error('boom') as any, host as any);

    expect(host.res.status).toHaveBeenCalledWith(500);
    expect(host.res.json).toHaveBeenCalledWith({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  });
});
