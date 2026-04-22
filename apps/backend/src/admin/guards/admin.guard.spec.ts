/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdminGuard } from './admin.guard';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AdminConfig } from '../admin.tokens';
import type { PrismaService } from '../../prisma/prisma.service';

function makeCtx(user?: any): ExecutionContext {
  const req: any = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makePrisma(row: any): PrismaService {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(row) },
  } as unknown as PrismaService;
}

describe('AdminGuard', () => {
  const cfg: AdminConfig = { emails: ['fallback@example.com'] };

  it('401 если нет req.user', async () => {
    const guard = new AdminGuard(makePrisma(null), cfg);
    await expect(guard.canActivate(makeCtx(undefined))).rejects.toThrow(UnauthorizedException);
  });

  it('403 если user удалён', async () => {
    const guard = new AdminGuard(
      makePrisma({ email: 'a@b.com', role: 'admin', deletedAt: new Date(), blockedAt: null }),
      cfg,
    );
    await expect(guard.canActivate(makeCtx({ userId: 'u1' }))).rejects.toThrow(ForbiddenException);
  });

  it('403 если user заблокирован', async () => {
    const guard = new AdminGuard(
      makePrisma({ email: 'a@b.com', role: 'admin', deletedAt: null, blockedAt: new Date() }),
      cfg,
    );
    await expect(guard.canActivate(makeCtx({ userId: 'u1' }))).rejects.toThrow(ForbiddenException);
  });

  it('403 если role=parent и email не в fallback-списке', async () => {
    const guard = new AdminGuard(
      makePrisma({
        email: 'stranger@example.com',
        role: 'parent',
        deletedAt: null,
        blockedAt: null,
      }),
      cfg,
    );
    await expect(guard.canActivate(makeCtx({ userId: 'u1' }))).rejects.toThrow(ForbiddenException);
  });

  it('true если role=admin в БД', async () => {
    const guard = new AdminGuard(
      makePrisma({ email: 'any@example.com', role: 'admin', deletedAt: null, blockedAt: null }),
      cfg,
    );
    await expect(guard.canActivate(makeCtx({ userId: 'u1' }))).resolves.toBe(true);
  });

  it('true если email в fallback-списке ADMIN_EMAILS', async () => {
    const guard = new AdminGuard(
      makePrisma({
        email: 'fallback@example.com',
        role: 'parent',
        deletedAt: null,
        blockedAt: null,
      }),
      cfg,
    );
    await expect(guard.canActivate(makeCtx({ userId: 'u1' }))).resolves.toBe(true);
  });
});
