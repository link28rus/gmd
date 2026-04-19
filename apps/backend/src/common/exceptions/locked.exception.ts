import { HttpException } from '@nestjs/common';

export class LockedException extends HttpException {
  constructor(message: string, retryAfterSec: number) {
    super(
      {
        code: 'account_locked',
        message,
        retryAfterSec,
      },
      423,
    );
  }
}
