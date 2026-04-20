/* eslint-disable @typescript-eslint/no-explicit-any */
import { UsersService } from './users.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AdminConfig } from '../admin/admin.tokens';
import type { ConsentService } from '../consent/consent.service';

interface MockPrisma {
  _users: any[];
  user: { findUnique: jest.Mock; update: jest.Mock };
  membership: { findMany: jest.Mock };
  family: { findUnique: jest.Mock };
  refreshToken: { updateMany: jest.Mock };
  child: { findMany: jest.Mock };
  $transaction: jest.Mock;
}

function makePrismaMock(): MockPrisma {
  const users: any[] = [];
  const api: MockPrisma = {
    _users: users,
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => u.id === where.id) ?? null),
      ),
      update: jest.fn(({ where, data }: any) => {
        const u = users.find((x) => x.id === where.id);
        Object.assign(u, data);
        return Promise.resolve(u);
      }),
    },
    membership: { findMany: jest.fn(() => Promise.resolve([])) },
    family: { findUnique: jest.fn(() => Promise.resolve(null)) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    child: { findMany: jest.fn(() => Promise.resolve([])) },
    $transaction: jest.fn((ops: any[]) =>
      Promise.all(ops.map((p) => (typeof p === 'function' ? p(api) : p))),
    ),
  };
  return api;
}

function makeConsentService(requiresConsent = false, version = '1.0'): ConsentService {
  return {
    userRequiresConsent: jest.fn(() => requiresConsent),
    getCurrentVersion: jest.fn(() => version),
  } as unknown as ConsentService;
}

describe('UsersService', () => {
  it('getMe возвращает user + family + memberships + children + requiresConsent + currentPolicyVersion', async () => {
    const p = makePrismaMock();
    p._users.push({
      id: 'u-1',
      email: 'a@b.com',
      name: null,
      locale: 'ru',
      deletedAt: null,
      acceptedPrivacyPolicyVersion: '1.0',
    });
    p.membership.findMany = jest.fn(() => Promise.resolve([{ role: 'owner', familyId: 'f-1' }]));
    p.family.findUnique = jest.fn(() => Promise.resolve({ id: 'f-1', name: 'Моя семья' }));
    p.child.findMany = jest.fn(() =>
      Promise.resolve([
        {
          id: 'ch-1',
          name: 'Vanya',
          dateOfBirth: null,
          device: { id: 'd-1', deviceName: 'Pixel' },
        },
      ]),
    );
    const adminCfg: AdminConfig = { emails: ['admin@example.com'] };
    const consent = makeConsentService(false, '1.0');
    const svc = new UsersService(p as unknown as PrismaService, adminCfg, consent);

    const r = await svc.getMe('u-1', 'f-1');

    expect(r.user.email).toBe('a@b.com');
    expect(r.family.name).toBe('Моя семья');
    expect(r.memberships[0].role).toBe('owner');
    expect(r.children).toHaveLength(1);
    expect(r.children[0].name).toBe('Vanya');
    expect(r.children[0].device?.deviceName).toBe('Pixel');
    expect(r.isAdmin).toBe(false);
    expect(r.hasPassword).toBe(false);
    expect(r.requiresConsent).toBe(false);
    expect(r.currentPolicyVersion).toBe('1.0');
  });

  it('getMe возвращает hasPassword=true когда passwordHash установлен', async () => {
    const p = makePrismaMock();
    p._users.push({
      id: 'u-pwd',
      email: 'pwd@example.com',
      name: null,
      locale: 'ru',
      deletedAt: null,
      acceptedPrivacyPolicyVersion: '1.0',
      passwordHash: '$2b$10$fakehash',
    });
    p.membership.findMany = jest.fn(() => Promise.resolve([{ role: 'owner', familyId: 'f-p' }]));
    p.family.findUnique = jest.fn(() => Promise.resolve({ id: 'f-p', name: 'Семья' }));
    p.child.findMany = jest.fn(() => Promise.resolve([]));
    const adminCfg: AdminConfig = { emails: [] };
    const consent = makeConsentService(false, '1.0');
    const svc = new UsersService(p as unknown as PrismaService, adminCfg, consent);

    const r = await svc.getMe('u-pwd', 'f-p');

    expect(r.hasPassword).toBe(true);
  });

  it('getMe возвращает isAdmin=true если email в whitelist', async () => {
    const p = makePrismaMock();
    p._users.push({
      id: 'u-2',
      email: 'ADMIN@Example.com',
      name: null,
      locale: 'ru',
      deletedAt: null,
      acceptedPrivacyPolicyVersion: '1.0',
    });
    p.membership.findMany = jest.fn(() => Promise.resolve([{ role: 'owner', familyId: 'f-2' }]));
    p.family.findUnique = jest.fn(() => Promise.resolve({ id: 'f-2', name: 'Семья' }));
    p.child.findMany = jest.fn(() => Promise.resolve([]));
    const adminCfg: AdminConfig = { emails: ['admin@example.com'] };
    const consent = makeConsentService(false, '1.0');
    const svc = new UsersService(p as unknown as PrismaService, adminCfg, consent);

    const r = await svc.getMe('u-2', 'f-2');

    expect(r.isAdmin).toBe(true);
  });

  it('getMe возвращает requiresConsent=true если версия устарела', async () => {
    const p = makePrismaMock();
    p._users.push({
      id: 'u-3',
      email: 'b@c.com',
      name: null,
      locale: 'ru',
      deletedAt: null,
      acceptedPrivacyPolicyVersion: '1.0',
    });
    p.membership.findMany = jest.fn(() => Promise.resolve([{ role: 'owner', familyId: 'f-3' }]));
    p.family.findUnique = jest.fn(() => Promise.resolve({ id: 'f-3', name: 'Семья' }));
    p.child.findMany = jest.fn(() => Promise.resolve([]));
    const adminCfg: AdminConfig = { emails: [] };
    const consent = makeConsentService(true, '2.0');
    const svc = new UsersService(p as unknown as PrismaService, adminCfg, consent);

    const r = await svc.getMe('u-3', 'f-3');

    expect(r.requiresConsent).toBe(true);
    expect(r.currentPolicyVersion).toBe('2.0');
  });

  it('updateMe патчит name и locale', async () => {
    const p = makePrismaMock();
    p._users.push({
      id: 'u-1',
      email: 'a@b.com',
      name: null,
      locale: 'ru',
      deletedAt: null,
    });
    const adminCfg: AdminConfig = { emails: [] };
    const consent = makeConsentService();
    const svc = new UsersService(p as unknown as PrismaService, adminCfg, consent);

    const r = await svc.updateMe('u-1', { name: 'Ivan', locale: 'en' });

    expect(r.name).toBe('Ivan');
    expect(r.locale).toBe('en');
  });

  it('softDelete выставляет deletedAt и revoke всех refresh', async () => {
    const p = makePrismaMock();
    p._users.push({ id: 'u-1', email: 'a@b.com', deletedAt: null });
    const adminCfg: AdminConfig = { emails: [] };
    const consent = makeConsentService();
    const svc = new UsersService(p as unknown as PrismaService, adminCfg, consent);

    await svc.softDelete('u-1');

    expect(p._users[0].deletedAt).not.toBeNull();
    expect(p.refreshToken.updateMany).toHaveBeenCalled();
  });
});
