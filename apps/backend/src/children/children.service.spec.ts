/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildrenService } from './children.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  _children: any[];
  _devices: any[];
  _invites: any[];
  _users: any[];
  child: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  childDevice: { updateMany: jest.Mock };
  invite: { updateMany: jest.Mock };
  user: { findUnique: jest.Mock };
  $transaction: jest.Mock;
}

function makePrismaMock(): MockPrisma {
  const children: any[] = [];
  const devices: any[] = [];
  const invites: any[] = [];
  const users: any[] = [];
  const api: MockPrisma = {
    _children: children,
    _devices: devices,
    _invites: invites,
    _users: users,
    child: {
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `c-${children.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          dateOfBirth: null,
          avatarKey: null,
          ...data,
        };
        children.push(row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          children.find(
            (c) => c.id === where.id && c.familyId === where.familyId && c.deletedAt === null,
          ) ?? null,
        ),
      ),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          children
            .filter((c) => c.familyId === where.familyId && c.deletedAt === null)
            .map((c) => ({
              ...c,
              device: devices.find((d) => d.childId === c.id) ?? null,
            })),
        ),
      ),
      update: jest.fn(({ where, data }: any) => {
        const c = children.find((x) => x.id === where.id);
        Object.assign(c, data);
        return Promise.resolve(c);
      }),
    },
    childDevice: {
      updateMany: jest.fn(({ where, data }: any) => {
        let count = 0;
        devices.forEach((d) => {
          if (d.childId === where.childId && d.revokedAt === null) {
            Object.assign(d, data);
            count++;
          }
        });
        return Promise.resolve({ count });
      }),
    },
    invite: {
      updateMany: jest.fn(({ where, data }: any) => {
        let count = 0;
        invites.forEach((i) => {
          if (i.childId === where.childId && i.consumedAt === null) {
            Object.assign(i, data);
            count++;
          }
        });
        return Promise.resolve({ count });
      }),
    },
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => u.id === where.id) ?? null),
      ),
    },
    $transaction: jest.fn((ops: any[] | ((tx: any) => unknown)) => {
      if (typeof ops === 'function') return ops(api);
      return Promise.all(ops);
    }),
  };
  return api;
}

describe('ChildrenService', () => {
  it('createChild вставляет row с familyId+name', async () => {
    const p = makePrismaMock();
    const svc = new ChildrenService(p as unknown as PrismaService);
    const r = await svc.createChild('fam-1', { name: 'Ваня' });
    expect(r.name).toBe('Ваня');
    expect(p._children[0].familyId).toBe('fam-1');
  });

  it('listChildren возвращает только family и не-deleted, с device', async () => {
    const p = makePrismaMock();
    const svc = new ChildrenService(p as unknown as PrismaService);
    p._children.push(
      { id: 'c1', familyId: 'f1', name: 'A', deletedAt: null },
      { id: 'c2', familyId: 'f1', name: 'B', deletedAt: new Date() },
      { id: 'c3', familyId: 'f2', name: 'C', deletedAt: null },
    );
    p._devices.push({ id: 'd1', childId: 'c1', revokedAt: null, deviceName: 'X' });
    const list = await svc.listChildren('f1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('c1');
    expect(list[0].device?.id).toBe('d1');
  });

  it('updateChild обновляет name', async () => {
    const p = makePrismaMock();
    const svc = new ChildrenService(p as unknown as PrismaService);
    p._children.push({ id: 'c1', familyId: 'f1', name: 'A', deletedAt: null });
    const r = await svc.updateChild('f1', 'c1', { name: 'Z' });
    expect(r.name).toBe('Z');
  });

  it('updateChild 404 если не в семье', async () => {
    const p = makePrismaMock();
    const svc = new ChildrenService(p as unknown as PrismaService);
    p._children.push({ id: 'c1', familyId: 'f2', name: 'A', deletedAt: null });
    await expect(svc.updateChild('f1', 'c1', { name: 'Z' })).rejects.toThrow(NotFoundException);
  });

  it('softDelete ставит deletedAt + revoke device + consume invites', async () => {
    const p = makePrismaMock();
    const svc = new ChildrenService(p as unknown as PrismaService);
    p._children.push({ id: 'c1', familyId: 'f1', name: 'A', deletedAt: null });
    p._devices.push({ id: 'd1', childId: 'c1', revokedAt: null });
    p._invites.push({ id: 'i1', childId: 'c1', consumedAt: null });
    await svc.softDelete('f1', 'c1');
    expect(p._children[0].deletedAt).not.toBeNull();
    expect(p._devices[0].revokedAt).not.toBeNull();
    expect(p._invites[0].consumedAt).not.toBeNull();
  });

  describe('protection', () => {
    it('getProtection возвращает дефолтное false для нового child', async () => {
      const p = makePrismaMock();
      const svc = new ChildrenService(p as unknown as PrismaService);
      p._children.push({
        id: 'c1',
        familyId: 'f1',
        deletedAt: null,
        protectionEnabled: false,
        protectionEnabledAt: null,
        protectionEnabledBy: null,
      });
      const s = await svc.getProtection('f1', 'c1');
      expect(s).toEqual({ enabled: false, enabledAt: null, enabledBy: null });
    });

    it('getProtection 404 если child не в семье', async () => {
      const p = makePrismaMock();
      const svc = new ChildrenService(p as unknown as PrismaService);
      await expect(svc.getProtection('f1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('setProtection enable=true без pinHash → 400 pin_not_set', async () => {
      const p = makePrismaMock();
      const svc = new ChildrenService(p as unknown as PrismaService);
      p._children.push({
        id: 'c1',
        familyId: 'f1',
        deletedAt: null,
        protectionEnabled: false,
      });
      p._users.push({ id: 'u1', pinHash: null });
      await expect(svc.setProtection('f1', 'c1', true, 'u1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(p._children[0].protectionEnabled).toBe(false);
    });

    it('setProtection enable=true с pinHash → сохраняет enabled+At+By', async () => {
      const p = makePrismaMock();
      const svc = new ChildrenService(p as unknown as PrismaService);
      p._children.push({
        id: 'c1',
        familyId: 'f1',
        deletedAt: null,
        protectionEnabled: false,
        protectionEnabledAt: null,
        protectionEnabledBy: null,
      });
      p._users.push({ id: 'u1', pinHash: 'hash' });
      const s = await svc.setProtection('f1', 'c1', true, 'u1');
      expect(s.enabled).toBe(true);
      expect(s.enabledBy).toBe('u1');
      expect(s.enabledAt).toBeInstanceOf(Date);
      expect(p._children[0].protectionEnabled).toBe(true);
    });

    it('setProtection enable=false не проверяет pinHash, зануляет At/By', async () => {
      const p = makePrismaMock();
      const svc = new ChildrenService(p as unknown as PrismaService);
      p._children.push({
        id: 'c1',
        familyId: 'f1',
        deletedAt: null,
        protectionEnabled: true,
        protectionEnabledAt: new Date(),
        protectionEnabledBy: 'u1',
      });
      const s = await svc.setProtection('f1', 'c1', false, 'u1');
      expect(s.enabled).toBe(false);
      expect(s.enabledAt).toBeNull();
      expect(s.enabledBy).toBeNull();
    });

    it('setProtection 404 если child не в семье', async () => {
      const p = makePrismaMock();
      const svc = new ChildrenService(p as unknown as PrismaService);
      await expect(svc.setProtection('f1', 'missing', true, 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
