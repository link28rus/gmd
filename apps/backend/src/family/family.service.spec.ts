/* eslint-disable @typescript-eslint/no-explicit-any */
import { FamilyService } from './family.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  _families: any[];
  _memberships: any[];
  family: { findUnique: jest.Mock; update: jest.Mock };
  membership: { findFirst: jest.Mock };
}

function makePrismaMock(): MockPrisma {
  const families: any[] = [];
  const memberships: any[] = [];
  return {
    _families: families,
    _memberships: memberships,
    family: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(families.find((f) => f.id === where.id) ?? null),
      ),
      update: jest.fn(({ where, data }: any) => {
        const f = families.find((x) => x.id === where.id);
        Object.assign(f, data);
        return Promise.resolve(f);
      }),
    },
    membership: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          memberships.find((m) => m.userId === where.userId && m.familyId === where.familyId) ??
            null,
        ),
      ),
    },
  };
}

describe('FamilyService', () => {
  it('rename owner успешно', async () => {
    const p = makePrismaMock();
    p._families.push({ id: 'f-1', name: 'Моя семья', deletedAt: null });
    p._memberships.push({ userId: 'u-1', familyId: 'f-1', role: 'owner' });
    const svc = new FamilyService(p as unknown as PrismaService);

    const r = await svc.rename('u-1', 'f-1', 'Кузнецовы');

    expect(r.name).toBe('Кузнецовы');
  });

  it('rename не-owner → ForbiddenException', async () => {
    const p = makePrismaMock();
    p._families.push({ id: 'f-1', name: 'Моя семья', deletedAt: null });
    p._memberships.push({ userId: 'u-1', familyId: 'f-1', role: 'parent' });
    const svc = new FamilyService(p as unknown as PrismaService);

    await expect(svc.rename('u-1', 'f-1', 'X')).rejects.toThrow(ForbiddenException);
  });

  it('rename несуществующей family → NotFoundException', async () => {
    const p = makePrismaMock();
    const svc = new FamilyService(p as unknown as PrismaService);

    await expect(svc.rename('u-1', 'f-missing', 'X')).rejects.toThrow(NotFoundException);
  });
});
