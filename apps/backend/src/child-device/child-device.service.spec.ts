/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildDeviceService } from './child-device.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConsentService } from '../consent/consent.service';
import type { PinService } from '../auth/pin.service';

interface MockPrisma {
  _invites: any[];
  _children: any[];
  _devices: any[];
  _users: any[];
  invite: { findFirst: jest.Mock; update: jest.Mock };
  childDevice: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  child: { findFirst: jest.Mock };
  user: { findMany: jest.Mock };
  $transaction: jest.Mock;
  $queryRawUnsafe: jest.Mock;
}

function makePrismaMock(): MockPrisma {
  const invites: any[] = [];
  const children: any[] = [];
  const devices: any[] = [];
  const users: any[] = [];
  const api: MockPrisma = {
    _invites: invites,
    _children: children,
    _devices: devices,
    _users: users,
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
      deleteMany: jest.fn(({ where }: any) => {
        const before = devices.length;
        for (let i = devices.length - 1; i >= 0; i--) {
          const d = devices[i];
          if (where.childId && d.childId !== where.childId) continue;
          if (where.revokedAt?.not === null && d.revokedAt === null) continue;
          devices.splice(i, 1);
        }
        return Promise.resolve({ count: before - devices.length });
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
    user: {
      findMany: jest.fn(({ where }: any) => {
        return Promise.resolve(
          users.filter((u) => {
            if (where?.deletedAt === null && u.deletedAt !== null) return false;
            if (where?.pinHash?.not === null && u.pinHash === null) return false;
            const familyId = where?.memberships?.some?.familyId;
            if (familyId && !u.familyIds?.includes(familyId)) return false;
            return true;
          }),
        );
      }),
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

function makeConsentMock() {
  return {
    recordChildConsent: jest.fn().mockResolvedValue(undefined),
  } as unknown as ConsentService;
}

function makePinMock() {
  return {
    hash: jest.fn().mockResolvedValue('h'),
    verify: jest.fn().mockResolvedValue(false),
    isLocked: jest.fn().mockResolvedValue({ locked: false, retryAfterSec: 0 }),
    recordFailure: jest.fn().mockResolvedValue({ locked: false, retryAfterSec: 0 }),
    clearFailures: jest.fn().mockResolvedValue(undefined),
    markVerified: jest.fn().mockResolvedValue(undefined),
    isVerified: jest.fn().mockResolvedValue(false),
    clearVerified: jest.fn().mockResolvedValue(undefined),
  } as unknown as PinService;
}

function makeSvc(p: MockPrisma, consent?: ConsentService, pin?: PinService) {
  return new ChildDeviceService(
    p as unknown as PrismaService,
    consent ?? makeConsentMock(),
    pin ?? makePinMock(),
  );
}

/** Returns a Date object representing `yearsAgo` years before today */
function dobYearsAgo(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d;
}

describe('ChildDeviceService.claim', () => {
  it('валидный invite → создаёт device + consumed invite + plain token', async () => {
    const p = makePrismaMock();
    p._children.push({
      id: 'c1',
      familyId: 'f1',
      name: 'Vanya',
      deletedAt: null,
      dateOfBirth: null,
    });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      createdBy: 'u-parent',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = makeSvc(p);
    const r = await svc.claim('K4HJ9XPN', { deviceName: 'Pixel' });
    expect(r.deviceToken.length).toBeGreaterThan(30);
    expect(r.child.id).toBe('c1');
    expect(r.child.name).toBe('Vanya');
    expect(r.device.id).toBe(p._devices[0].id);
    expect(p._invites[0].consumedAt).not.toBeNull();
    expect(p._devices[0].tokenHash).not.toBe(r.deviceToken);
    expect(p._devices[0].deviceName).toBe('Pixel');
  });

  it('несуществующий код → 400 invite_invalid', async () => {
    const p = makePrismaMock();
    const svc = makeSvc(p);
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
    const svc = makeSvc(p);
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
    const svc = makeSvc(p);
    await expect(svc.claim('K4HJ9XPN', {})).rejects.toThrow(BadRequestException);
  });

  it('у child уже есть device → 409', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'V', deletedAt: null, dateOfBirth: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      createdBy: 'u-parent',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    p._devices.push({ id: 'd1', childId: 'c1', revokedAt: null });
    const svc = makeSvc(p);
    await expect(svc.claim('K4HJ9XPN', {})).rejects.toThrow(ConflictException);
  });

  it('revoked device для того же child → старая запись удаляется, новый claim проходит', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'V', deletedAt: null, dateOfBirth: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      createdBy: 'u-parent',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    // старый device — revoked (имитирует повторный claim после /reset-device)
    p._devices.push({
      id: 'd-old',
      childId: 'c1',
      revokedAt: new Date(),
      tokenHash: 'old-hash',
    });
    const svc = makeSvc(p);
    const r = await svc.claim('K4HJ9XPN', { deviceName: 'Pixel-new' });
    expect(r.deviceToken).toBeTruthy();
    // старая запись удалена, в массиве остался только новый device
    expect(p._devices).toHaveLength(1);
    expect(p._devices[0].id).not.toBe('d-old');
    expect(p._devices[0].revokedAt).toBeNull();
    expect(p._devices[0].deviceName).toBe('Pixel-new');
  });

  it('нормализует code (lower-case и пробелы)', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'V', deletedAt: null, dateOfBirth: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      createdBy: 'u-parent',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = makeSvc(p);
    const r = await svc.claim(' k4hj-9xpn ', {});
    expect(r.deviceToken).toBeTruthy();
  });

  // 14+ consent tests
  it('ребёнок 13 лет без consent14Plus → успех', async () => {
    const p = makePrismaMock();
    p._children.push({
      id: 'c-13',
      familyId: 'f1',
      name: 'Young',
      deletedAt: null,
      dateOfBirth: dobYearsAgo(13),
    });
    p._invites.push({
      id: 'i-13',
      code: 'ABCD1234',
      familyId: 'f1',
      childId: 'c-13',
      createdBy: 'u-parent',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = makeSvc(p);
    const r = await svc.claim('ABCD1234', {});
    expect(r.deviceToken).toBeTruthy();
  });

  it('ребёнок 14 лет без consent14Plus → 400 consent14plus_required', async () => {
    const p = makePrismaMock();
    p._children.push({
      id: 'c-14',
      familyId: 'f1',
      name: 'Teen',
      deletedAt: null,
      dateOfBirth: dobYearsAgo(14),
    });
    p._invites.push({
      id: 'i-14',
      code: 'EFGH5678',
      familyId: 'f1',
      childId: 'c-14',
      createdBy: 'u-parent',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = makeSvc(p);
    const err = await svc.claim('EFGH5678', {}).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'consent14plus_required' });
  });

  it('ребёнок 14 лет с consent14Plus=true → успех и recordChildConsent вызван', async () => {
    const p = makePrismaMock();
    p._children.push({
      id: 'c-14ok',
      familyId: 'f1',
      name: 'Teen',
      deletedAt: null,
      dateOfBirth: dobYearsAgo(14),
    });
    p._invites.push({
      id: 'i-14ok',
      code: 'IJKL9012',
      familyId: 'f1',
      childId: 'c-14ok',
      createdBy: 'u-parent',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const consent = makeConsentMock();
    const svc = makeSvc(p, consent);
    const r = await svc.claim('IJKL9012', { consent14Plus: true });
    expect(r.deviceToken).toBeTruthy();
    expect(consent.recordChildConsent).toHaveBeenCalledWith(
      'c-14ok',
      'u-parent',
      undefined,
      undefined,
    );
  });
});

describe('ChildDeviceService.verifyToken', () => {
  it('возвращает context для валидного token', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'V', deletedAt: null, dateOfBirth: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      createdBy: 'u-parent',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = makeSvc(p);
    const claimed = await svc.claim('K4HJ9XPN', {});
    const ctx = await svc.verifyToken(claimed.deviceToken);
    expect(ctx).not.toBeNull();
    expect(ctx?.childId).toBe('c1');
    expect(ctx?.familyId).toBe('f1');
  });

  it('null для revoked token', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', name: 'V', deletedAt: null, dateOfBirth: null });
    p._invites.push({
      id: 'i1',
      code: 'K4HJ9XPN',
      familyId: 'f1',
      childId: 'c1',
      createdBy: 'u-parent',
      expiresAt: new Date(Date.now() + 600_000),
      consumedAt: null,
    });
    const svc = makeSvc(p);
    const claimed = await svc.claim('K4HJ9XPN', {});
    p._devices[0].revokedAt = new Date();
    const ctx = await svc.verifyToken(claimed.deviceToken);
    expect(ctx).toBeNull();
  });

  it('null для несуществующего token', async () => {
    const p = makePrismaMock();
    const svc = makeSvc(p);
    const ctx = await svc.verifyToken('completely-fake-token');
    expect(ctx).toBeNull();
  });

  describe('verifyParentPin', () => {
    it('ok когда один из родителей семьи имеет matching PIN', async () => {
      const p = makePrismaMock();
      const pin = makePinMock();
      (pin.verify as jest.Mock).mockImplementation(async (hash: string, plain: string) => {
        return hash === 'ok-hash' && plain === '1234';
      });
      p._users.push(
        { id: 'u1', deletedAt: null, pinHash: 'wrong', familyIds: ['f1'] },
        { id: 'u2', deletedAt: null, pinHash: 'ok-hash', familyIds: ['f1'] },
      );
      const svc = makeSvc(p, undefined, pin);
      const res = await svc.verifyParentPin({
        deviceId: 'd1',
        childId: 'c1',
        familyId: 'f1',
        pin: '1234',
      });
      expect(res.ok).toBe(true);
      expect(pin.clearFailures).toHaveBeenCalledWith('child-device:d1');
    });

    it('401 invalid_pin когда PIN не совпадает ни с одним родителем', async () => {
      const p = makePrismaMock();
      const pin = makePinMock();
      (pin.verify as jest.Mock).mockResolvedValue(false);
      p._users.push({ id: 'u1', deletedAt: null, pinHash: 'h', familyIds: ['f1'] });
      const svc = makeSvc(p, undefined, pin);
      await expect(
        svc.verifyParentPin({ deviceId: 'd1', childId: 'c1', familyId: 'f1', pin: '0000' }),
      ).rejects.toMatchObject({ status: 401 });
      expect(pin.recordFailure).toHaveBeenCalledWith('child-device:d1');
    });

    it('401 no_parent_pin когда ни у одного родителя не задан PIN', async () => {
      const p = makePrismaMock();
      const pin = makePinMock();
      const svc = makeSvc(p, undefined, pin);
      await expect(
        svc.verifyParentPin({ deviceId: 'd1', childId: 'c1', familyId: 'f1', pin: '1234' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'no_parent_pin' }),
      });
    });

    it('429 pin_locked при текущей блокировке', async () => {
      const p = makePrismaMock();
      const pin = makePinMock();
      (pin.isLocked as jest.Mock).mockResolvedValue({ locked: true, retryAfterSec: 600 });
      p._users.push({ id: 'u1', deletedAt: null, pinHash: 'h', familyIds: ['f1'] });
      const svc = makeSvc(p, undefined, pin);
      await expect(
        svc.verifyParentPin({ deviceId: 'd1', childId: 'c1', familyId: 'f1', pin: '1234' }),
      ).rejects.toMatchObject({ status: 429 });
    });
  });
});
