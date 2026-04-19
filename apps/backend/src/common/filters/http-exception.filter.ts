import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

type ErrorPayload = { code: string; message: string; details?: unknown; [key: string]: unknown };

function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    default:
      return 'internal_error';
  }
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = normalize(body, status);
      res.status(status).json({ error: payload });
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  }
}

function normalize(body: unknown, status: number): ErrorPayload {
  if (typeof body === 'string') {
    return { code: statusToCode(status), message: body };
  }
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const code = typeof b.code === 'string' ? b.code : statusToCode(status);
    const message =
      typeof b.message === 'string'
        ? b.message
        : typeof b.error === 'string'
          ? (b.error as string)
          : 'Error';
    const { code: _c, message: _m, error: _e, ...rest } = b;
    void _c;
    void _m;
    void _e;
    return { code, message, ...rest };
  }
  return { code: statusToCode(status), message: 'Error' };
}
