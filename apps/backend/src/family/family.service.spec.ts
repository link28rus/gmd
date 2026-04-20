/* eslint-disable @typescript-eslint/no-explicit-any */
import { FamilyService } from './family.service';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  _families: any[];
  _memberships: any[];
  _sosEvents: any[];
  family: { findUnique: jest.Mock; update: jest.Mock };
  membership: { findFirst: jest.Mock; findMany: jest.Mock };
  sosEvent: { findMany: jest.Mock };
}

function makePrismaMock(): MockPrisma {
  const families: any[] = [];
  const memberships: any[] = [];
  const sosEvents: any[] = [];
  return {
    _families: families,
    _memberships: memberships,
    _sosEvents: sosEvents,
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
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          memberships
            .filter((m) => m.userId === where.userId)
            .map((m) => ({ familyId: m.familyId })),
        ),
      ),
    },
    sosEvent: {
      findMany: jest.fn(({ where, orderBy: _orderBy, take }: any) => {
        const familyIds: string[] = where?.child?.familyId?.in ?? [];
        const since: Date | undefined = where?.serverCreatedAt?.gte;
        const filtered = sosEvents.filter((e) => {
          if (!familyIds.includes(e._familyId)) return false;
          if (since && e.serverCreatedAt < since) return false;
          return true;
        });
        filtered.sort((a, b) => b.serverCreatedAt.getTime() - a.serverCreatedAt.getTime());
        return Promise.resolve(filtered.slice(0, take ?? 50));
      }),
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

  describe('listFamilySos', () => {
    it('returns empty when user has no memberships', async () => {
      const p = makePrismaMock();
      const svc = new FamilyService(p as unknown as PrismaService);

      const r = await svc.listFamilySos('u-0');

      expect(r.events).toEqual([]);
    });

    it('maps events from all user families, sorted desc', async () => {
      const p = makePrismaMock();
      p._memberships.push({ userId: 'u-1', familyId: 'f-1', role: 'owner' });
      p._memberships.push({ userId: 'u-1', familyId: 'f-2', role: 'parent' });
      const oldDate = new Date('2026-04-19T10:00:00Z');
      const newDate = new Date('2026-04-20T10:00:00Z');
      p._sosEvents.push({
        id: 'e-old',
        childId: 'c-1',
        _familyId: 'f-1',
        lat: 1,
        lon: 1,
        accuracy: null,
        recordedAt: oldDate,
        serverCreatedAt: oldDate,
        message: null,
        acknowledgedAt: null,
      });
      p._sosEvents.push({
        id: 'e-new',
        childId: 'c-2',
        _familyId: 'f-2',
        lat: 2,
        lon: 2,
        accuracy: 5,
        recordedAt: newDate,
        serverCreatedAt: newDate,
        message: 'help',
        acknowledgedAt: null,
      });
      const svc = new FamilyService(p as unknown as PrismaService);

      const r = await svc.listFamilySos('u-1');

      expect(r.events).toHaveLength(2);
      expect(r.events[0].id).toBe('e-new');
      expect(r.events[1].id).toBe('e-old');
      expect(r.events[0].recordedAt).toBe(newDate.toISOString());
      expect(r.events[0].message).toBe('help');
    });

    it('since filter excludes older events', async () => {
      const p = makePrismaMock();
      p._memberships.push({ userId: 'u-1', familyId: 'f-1', role: 'owner' });
      const oldDate = new Date('2026-04-19T10:00:00Z');
      const newDate = new Date('2026-04-20T10:00:00Z');
      p._sosEvents.push({
        id: 'e-old',
        childId: 'c-1',
        _familyId: 'f-1',
        lat: 1,
        lon: 1,
        accuracy: null,
        recordedAt: oldDate,
        serverCreatedAt: oldDate,
        message: null,
        acknowledgedAt: null,
      });
      p._sosEvents.push({
        id: 'e-new',
        childId: 'c-1',
        _familyId: 'f-1',
        lat: 2,
        lon: 2,
        accuracy: null,
        recordedAt: newDate,
        serverCreatedAt: newDate,
        message: null,
        acknowledgedAt: null,
      });
      const svc = new FamilyService(p as unknown as PrismaService);

      const r = await svc.listFamilySos('u-1', new Date('2026-04-20T00:00:00Z'));

      expect(r.events).toHaveLength(1);
      expect(r.events[0].id).toBe('e-new');
    });
  });
});
