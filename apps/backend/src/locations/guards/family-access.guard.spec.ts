/* eslint-disable @typescript-eslint/no-explicit-any */
import { NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { FamilyAccessGuard } from './family-access.guard';

function mockCtx(userId: string, childId: string, accept = true): ExecutionContext {
  const req: any = {
    user: accept ? { userId } : undefined,
    params: { id: childId },
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('FamilyAccessGuard', () => {
  const findFirst = jest.fn();
  const prisma: any = { child: { findFirst } };
  const guard = new FamilyAccessGuard(prisma);

  beforeEach(() => findFirst.mockReset());

  it('allows when child belongs to user family', async () => {
    findFirst.mockResolvedValue({ id: 'c1', familyId: 'f1', deletedAt: null });
    const ctx = mockCtx('u1', 'c1');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: 'c1',
        deletedAt: null,
        family: { memberships: { some: { userId: 'u1' } } },
      },
    });
  });

  it('throws 404 child_not_found when child missing', async () => {
    findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(mockCtx('u1', 'c1'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 404 child_not_found when child soft-deleted (findFirst with deletedAt filter returns null)', async () => {
    findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(mockCtx('u1', 'c1'))).rejects.toMatchObject({
      response: { code: 'child_not_found' },
    });
  });

  it('attaches targetChild to request', async () => {
    const child = { id: 'c1', familyId: 'f1', deletedAt: null };
    findFirst.mockResolvedValue(child);
    const ctx = mockCtx('u1', 'c1');
    await guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.targetChild).toEqual(child);
  });
});
