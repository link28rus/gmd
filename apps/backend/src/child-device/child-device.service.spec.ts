/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildDeviceService } from './child-device.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  _invites: any[];
  _children: any[];
  _devices: any[];
  invite: { findFirst: jest.Mock; update: jest.Mock };
  childDevice: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
  child: { findFirst: jest.Mock };
  $transaction: jest.Mock;
  $queryRawUnsafe: jest.Mock;
}

function makePrismaMock(): MockPrisma {
  const invites: any[] = [];
  const children: any[] = [];
  const devices: any[] = [];
  const api: MockPrisma = {
    _invites: invites,
    _children: children,
    _devices: devices,
    invite: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(invites.find((i) => i.id === where.id) ?? null),
      ),
      update: jest.fn(({ where, data }: any) => {
        const row = invites.find((i) => i.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    childDevice: {
      findFirst: jest.fn(({ where }: any) => {
        return Promise.resolve(
          devices.find((d) => {
            if (where.tokenHash) return d.tokenHash === where.tokenHash && d.revokedAt === null;
            if (where.childId) return d.childId === where.childId && d.revokedAt === null;
            return false;
          }) ?? null,
        );
      }),
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `d-${devices.length + 1}`,
          createdAt: new Date(),
          lastSeenAt: null,
          revokedAt: null,
          ...data,
        };
        devices.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = devices.find((d) => d.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    child: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          children.find(
            (c) => c.id === where.id && (where.deletedAt === null ? c.deletedAt === null : true),
          ) ?? null,
        ),
      ),
    },
    $transaction: jest.fn((fn: any) => fn(api)),
    $queryRawUnsafe: jest.fn((_sql: string, code: string) => {
      const row = invites.find(
        (i) => i.code === code && i.consumedAt === null && i.expiresAt > new Date(),
      );
      return Promise.resolve(row ? [{ id: row.id }] : []);
    }),
  };
  return api;
}

describe('ChildDeviceService.claim', () => {
  it('валидный invite → создаёт device + consumed invite + plain token', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'Vanya', deletedAt: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = new ChildDeviceService(p as unknown as PrismaService);
    const r = await svc.claim('K4HJ9XPN', { deviceName: 'Pixel' });
    expect(r.deviceToken.length).toBeGreaterThan(30);
    expect(r.child.id).toBe('c1');
    expect(r.child.name).toBe('Vanya');
    expect(p._invites[0].consumedAt).not.toBeNull();
    expect(p._devices[0].tokenHash).not.toBe(r.deviceToken);
    expect(p._devices[0].deviceName).toBe('Pixel');
  });

  it('несуществующий код → 400 invite_invalid', async () => {
    const p = makePrismaMock();
    const svc = new ChildDeviceService(p as unknown as PrismaService);
    await expect(svc.claim('NOTHING1', {})).rejects.toThrow(BadRequestException);
  });

  it('expired → 400', async () => {
    const p = makePrismaMock();
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      childId: 'c1',
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    });
    const svc = new ChildDeviceService(p as unknown as PrismaService);
    await expect(svc.claim('K4HJ9XPN', {})).rejects.toThrow(BadRequestException);
  });

  it('consumed → 400', async () => {
    const p = makePrismaMock();
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      childId: 'c1',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: new Date(),
    });
    const svc = new ChildDeviceService(p as unknown as PrismaService);
    await expect(svc.claim('K4HJ9XPN', {})).rejects.toThrow(BadRequestException);
  });

  it('у child уже есть device → 409', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'V', deletedAt: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    p._devices.push({ id: 'd1', childId: 'c1', revokedAt: null });
    const svc = new ChildDeviceService(p as unknown as PrismaService);
    await expect(svc.claim('K4HJ9XPN', {})).rejects.toThrow(ConflictException);
  });

  it('нормализует code (lower-case и пробелы)', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'V', deletedAt: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = new ChildDeviceService(p as unknown as PrismaService);
    const r = await svc.claim(' k4hj-9xpn ', {});
    expect(r.deviceToken).toBeTruthy();
  });
});

describe('ChildDeviceService.verifyToken', () => {
  it('возвращает context для валидного token', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'V', deletedAt: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = new ChildDeviceService(p as unknown as PrismaService);
    const claimed = await svc.claim('K4HJ9XPN', {});
    const ctx = await svc.verifyToken(claimed.deviceToken);
    expect(ctx).not.toBeNull();
    expect(ctx?.childId).toBe('c1');
    expect(ctx?.familyId).toBe('f1');
  });

  it('null для revoked token', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'V', deletedAt: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = new ChildDeviceService(p as unknown as PrismaService);
    const claimed = await svc.claim('K4HJ9XPN', {});
    p._devices[0].revokedAt = new Date();
    const ctx = await svc.verifyToken(claimed.deviceToken);
    expect(ctx).toBeNull();
  });

  it('null для несуществующего token', async () => {
    const p = makePrismaMock();
    const svc = new ChildDeviceService(p as unknown as PrismaService);
    const ctx = await svc.verifyToken('completely-fake-token');
    expect(ctx).toBeNull();
  });
});
