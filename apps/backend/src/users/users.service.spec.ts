/* eslint-disable @typescript-eslint/no-explicit-any */
import { UsersService } from './users.service';
import type { PrismaService } from '../prisma/prisma.service';

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

describe('UsersService', () => {
  it('getMe возвращает user + family + memberships + children', async () => {
    const p = makePrismaMock();
    p._users.push({
      id: 'u-1',
      email: 'a@b.com',
      name: null,
      locale: 'ru',
      deletedAt: null,
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
    const svc = new UsersService(p as unknown as PrismaService);

    const r = await svc.getMe('u-1', 'f-1');

    expect(r.user.email).toBe('a@b.com');
    expect(r.family.name).toBe('Моя семья');
    expect(r.memberships[0].role).toBe('owner');
    expect(r.children).toHaveLength(1);
    expect(r.children[0].name).toBe('Vanya');
    expect(r.children[0].device?.deviceName).toBe('Pixel');
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
    const svc = new UsersService(p as unknown as PrismaService);

    const r = await svc.updateMe('u-1', { name: 'Ivan', locale: 'en' });

    expect(r.name).toBe('Ivan');
    expect(r.locale).toBe('en');
  });

  it('softDelete выставляет deletedAt и revoke всех refresh', async () => {
    const p = makePrismaMock();
    p._users.push({ id: 'u-1', email: 'a@b.com', deletedAt: null });
    const svc = new UsersService(p as unknown as PrismaService);

    await svc.softDelete('u-1');

    expect(p._users[0].deletedAt).not.toBeNull();
    expect(p.refreshToken.updateMany).toHaveBeenCalled();
  });
});
