/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdminGuard } from './admin.guard';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AdminConfig } from '../admin.tokens';

function makeCtx(user?: any): ExecutionContext {
  const req: any = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const cfg: AdminConfig = { emails: ['link28rus@gmail.com', 'admin@example.com'] };

  it('403 если нет req.user', () => {
    const guard = new AdminGuard(cfg);
    expect(() => guard.canActivate(makeCtx(undefined))).toThrow(ForbiddenException);
  });

  it('403 если email не в whitelist', () => {
    const guard = new AdminGuard(cfg);
    expect(() => guard.canActivate(makeCtx({ email: 'stranger@example.com' }))).toThrow(
      ForbiddenException,
    );
  });

  it('true если email точно совпадает', () => {
    const guard = new AdminGuard(cfg);
    expect(guard.canActivate(makeCtx({ email: 'link28rus@gmail.com' }))).toBe(true);
  });

  it('true если email отличается регистром (case-insensitive)', () => {
    const guard = new AdminGuard(cfg);
    expect(guard.canActivate(makeCtx({ email: 'LINK28rus@Gmail.com' }))).toBe(true);
  });
});
