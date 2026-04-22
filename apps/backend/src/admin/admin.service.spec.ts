import { AdminService } from './admin.service';
import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { PasswordResetService } from '../auth/password-reset.service';

function makePasswordReset(): PasswordResetService {
  return {
    issueAndSend: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn(),
  } as unknown as PasswordResetService;
}

/**
 * Minimal mock for Prisma methods used by AdminService.
 */
function makePrisma() {
  return {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    family: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    child: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    childDevice: {
      count: jest.fn(),
    },
    invite: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    refreshToken: {
      count: jest.fn(),
    },
    otpCode: {
      count: jest.fn(),
    },
    membership: {
      findMany: jest.fn(),
    },
  } as unknown as PrismaService;
}

describe('AdminService', () => {
  it('getStats возвращает корректную структуру', async () => {
    const p = makePrisma();
    (p.user.count as jest.Mock)
      .mockResolvedValue(10)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(2);
    (p.family.count as jest.Mock).mockResolvedValue(5);
    (p.child.count as jest.Mock)
      .mockResolvedValue(8)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(1);
    (p.childDevice.count as jest.Mock)
      .mockResolvedValue(3)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    (p.invite.count as jest.Mock)
      .mockResolvedValue(15)
      .mockResolvedValueOnce(15)
      .mockResolvedValueOnce(4);
    const svc = new AdminService(p, makePasswordReset());
    const r = await svc.getStats();
    expect(r).toHaveProperty('users');
    expect(r).toHaveProperty('families');
    expect(r).toHaveProperty('children');
    expect(r).toHaveProperty('devices');
    expect(r).toHaveProperty('invites');
  });

  it('listUsers возвращает items + total + page + limit', async () => {
    const p = makePrisma();
    (p.user.count as jest.Mock).mockResolvedValue(3);
    (p.user.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'u1',
        email: 'a@b.com',
        name: 'A',
        locale: 'ru',
        acceptedPrivacyPolicyVersion: '1.0',
        createdAt: new Date(),
        deletedAt: null,
        memberships: [{ familyId: 'f1', family: { name: 'Семья А' } }],
        _count: { memberships: 1 },
      },
    ]);
    const svc = new AdminService(p, makePasswordReset());
    const r = await svc.listUsers(1, 50);
    expect(r.total).toBe(3);
    expect(r.items).toHaveLength(1);
    expect(r.page).toBe(1);
    expect(r.limit).toBe(50);
  });

  it('listUsers фильтрует по q (email substring)', async () => {
    const p = makePrisma();
    (p.user.count as jest.Mock).mockResolvedValue(1);
    (p.user.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'u1',
        email: 'admin@example.com',
        name: null,
        locale: 'ru',
        acceptedPrivacyPolicyVersion: null,
        createdAt: new Date(),
        deletedAt: null,
        memberships: [],
        _count: { memberships: 0 },
      },
    ]);
    const svc = new AdminService(p, makePasswordReset());
    const r = await svc.listUsers(1, 50, 'admin');
    // verify Prisma was called with contains filter
    const call = (p.user.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where?.email?.contains).toBe('admin');
    expect(r.items[0].email).toBe('admin@example.com');
  });

  it('getUserDetail 404 если не найден', async () => {
    const p = makePrisma();
    (p.user.findUnique as jest.Mock).mockResolvedValue(null);
    const svc = new AdminService(p, makePasswordReset());
    await expect(svc.getUserDetail('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('getUserDetail возвращает структуру с memberships + children', async () => {
    const p = makePrisma();
    (p.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      locale: 'ru',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      acceptedPrivacyPolicyVersion: '1.0',
      memberships: [{ familyId: 'f1', role: 'owner', family: { name: 'Семья А' } }],
    });
    (p.child.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'ch1',
        name: 'Ваня',
        dateOfBirth: null,
        device: null,
        memberships: [],
      },
    ]);
    (p.refreshToken.count as jest.Mock).mockResolvedValue(2);
    (p.otpCode.count as jest.Mock).mockResolvedValue(1);
    const svc = new AdminService(p, makePasswordReset());
    const r = await svc.getUserDetail('u1');
    expect(r.user.email).toBe('a@b.com');
    expect(r.memberships).toHaveLength(1);
    expect(r.children).toHaveLength(1);
    expect(r.refreshTokensActive).toBe(2);
    expect(r.otpCodesActiveLast24h).toBe(1);
  });

  it('listFamilies возвращает items с пагинацией', async () => {
    const p = makePrisma();
    (p.family.count as jest.Mock).mockResolvedValue(2);
    (p.family.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f1',
        name: 'Семья',
        createdAt: new Date(),
        _count: { memberships: 2, children: 1 },
        children: [{ device: { revokedAt: null } }],
      },
    ]);
    const svc = new AdminService(p, makePasswordReset());
    const r = await svc.listFamilies(1, 50);
    expect(r.total).toBe(2);
    expect(r.items[0].id).toBe('f1');
    expect(r.items[0].membersCount).toBe(2);
  });

  it('listChildren возвращает items с пагинацией', async () => {
    const p = makePrisma();
    (p.child.count as jest.Mock).mockResolvedValue(3);
    (p.child.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'ch1',
        name: 'Ваня',
        dateOfBirth: null,
        familyId: 'f1',
        family: { name: 'Семья' },
        device: null,
        deletedAt: null,
      },
    ]);
    const svc = new AdminService(p, makePasswordReset());
    const r = await svc.listChildren(1, 50);
    expect(r.total).toBe(3);
    expect(r.items[0].name).toBe('Ваня');
    expect(r.items[0].deviceStatus).toBe('none');
  });

  it('listActiveInvites возвращает только активные', async () => {
    const p = makePrisma();
    const now = new Date();
    const future = new Date(now.getTime() + 60_000);
    (p.invite.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'i1',
        code: 'ABC123',
        childId: 'ch1',
        child: { name: 'Ваня' },
        familyId: 'f1',
        family: { name: 'Семья' },
        expiresAt: future,
        consumedAt: null,
        createdAt: now,
        createdBy: 'u1',
      },
    ]);
    (p.user.findMany as jest.Mock).mockResolvedValue([{ id: 'u1', email: 'parent@example.com' }]);
    const svc = new AdminService(p, makePasswordReset());
    const r = await svc.listActiveInvites();
    expect(r.items).toHaveLength(1);
    expect(r.items[0].code).toBe('ABC123');
    expect(r.items[0].createdByEmail).toBe('parent@example.com');
  });
});
