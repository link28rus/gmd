/* eslint-disable @typescript-eslint/no-explicit-any */
import { RefreshTokenService } from './refresh-token.service';
import type { RefreshTokenConfig } from './refresh-token.service';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  _rows: any[];
  refreshToken: {
    create: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
}

function makePrismaMock(): MockPrisma {
  const rows: any[] = [];
  return {
    _rows: rows,
    refreshToken: {
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `rt-${rows.length + 1}`,
          revokedAt: null,
          rotatedToId: null,
          createdAt: new Date(),
          ...data,
        };
        rows.push(row);
        return Promise.resolve(row);
      }),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(rows.find((r) => r.tokenHash === where.tokenHash) ?? null),
      ),
      update: jest.fn(({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        let count = 0;
        rows.forEach((r) => {
          if (r.userId === where.userId && r.revokedAt === null) {
            Object.assign(r, data);
            count++;
          }
        });
        return Promise.resolve({ count });
      }),
    },
  };
}

const cfg: RefreshTokenConfig = { ttlSec: 86400 };

describe('RefreshTokenService', () => {
  it('create возвращает plain token и пишет tokenHash в БД', async () => {
    const p = makePrismaMock();
    const svc = new RefreshTokenService(p as unknown as PrismaService, cfg);
    const { token } = await svc.create('user-1', { userAgent: 'UA', ipAddress: '1.2.3.4' });
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(30);
    expect(p._rows[0].tokenHash).not.toBe(token);
    expect(p._rows[0].userId).toBe('user-1');
  });

  it('rotate: старый token → revoked + rotatedToId, возвращает новый token', async () => {
    const p = makePrismaMock();
    const svc = new RefreshTokenService(p as unknown as PrismaService, cfg);
    const { token: t1 } = await svc.create('user-1', {});
    const r = await svc.rotate(t1, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token).not.toBe(t1);
    expect(p._rows[0].revokedAt).not.toBeNull();
    expect(p._rows[0].rotatedToId).toBe(p._rows[1].id);
  });

  it('rotate несуществующего token → invalid', async () => {
    const p = makePrismaMock();
    const svc = new RefreshTokenService(p as unknown as PrismaService, cfg);
    const r = await svc.rotate('fake-token', {});
    expect(r.ok).toBe(false);
  });

  it('replay detection: повторная rotate старого token → revoke всей цепочки user', async () => {
    const p = makePrismaMock();
    const svc = new RefreshTokenService(p as unknown as PrismaService, cfg);
    const { token: t1 } = await svc.create('user-1', {});
    await svc.rotate(t1, {});
    const r = await svc.rotate(t1, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.replay).toBe(true);
    for (const row of p._rows.filter((x: any) => x.userId === 'user-1')) {
      expect(row.revokedAt).not.toBeNull();
    }
  });

  it('revoke сбрасывает конкретный token', async () => {
    const p = makePrismaMock();
    const svc = new RefreshTokenService(p as unknown as PrismaService, cfg);
    const { token } = await svc.create('user-1', {});
    await svc.revoke(token);
    expect(p._rows[0].revokedAt).not.toBeNull();
  });

  it('expired token → invalid при rotate', async () => {
    const p = makePrismaMock();
    const shortCfg: RefreshTokenConfig = { ttlSec: -10 };
    const svc = new RefreshTokenService(p as unknown as PrismaService, shortCfg);
    const { token } = await svc.create('user-1', {});
    const r = await svc.rotate(token, {});
    expect(r.ok).toBe(false);
  });
});
