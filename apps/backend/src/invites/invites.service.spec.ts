/* eslint-disable @typescript-eslint/no-explicit-any */
import { InvitesService } from './invites.service';
import type { InvitesServiceConfig } from './invites.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  _invites: any[];
  _children: any[];
  _devices: any[];
  child: { findFirst: jest.Mock };
  childDevice: { findFirst: jest.Mock; updateMany: jest.Mock };
  invite: { create: jest.Mock };
}

function makePrismaMock(): MockPrisma {
  const invites: any[] = [];
  const children: any[] = [];
  const devices: any[] = [];
  return {
    _invites: invites,
    _children: children,
    _devices: devices,
    child: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          children.find(
            (c) => c.id === where.id && c.familyId === where.familyId && c.deletedAt === null,
          ) ?? null,
        ),
      ),
    },
    childDevice: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          devices.find((d) => d.childId === where.childId && d.revokedAt === null) ?? null,
        ),
      ),
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
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `i-${invites.length + 1}`,
          createdAt: new Date(),
          consumedAt: null,
          ...data,
        };
        invites.push(row);
        return Promise.resolve(row);
      }),
    },
  };
}

const cfg: InvitesServiceConfig = {
  ttlSec: 600,
  landingBaseUrl: 'https://gmd.test',
};

describe('InvitesService.createInvite', () => {
  it('создаёт invite если у child нет device', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', deletedAt: null, name: 'A' });
    const svc = new InvitesService(p as unknown as PrismaService, cfg);
    const r = await svc.createInvite('f1', 'c1', 'u1');
    expect(r.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(r.qrUrl).toBe(`https://gmd.test/claim/${r.code}`);
    expect(r.deepLink).toBe(`gmd://claim/${r.code}`);
    expect(r.expiresIn).toBe(600);
    expect(p._invites[0].familyId).toBe('f1');
    expect(p._invites[0].childId).toBe('c1');
    expect(p._invites[0].createdBy).toBe('u1');
  });

  it('404 если child не в семье', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f2', deletedAt: null });
    const svc = new InvitesService(p as unknown as PrismaService, cfg);
    await expect(svc.createInvite('f1', 'c1', 'u1')).rejects.toThrow(NotFoundException);
  });

  it('409 если у child есть active device', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', deletedAt: null });
    p._devices.push({ id: 'd1', childId: 'c1', revokedAt: null });
    const svc = new InvitesService(p as unknown as PrismaService, cfg);
    await expect(svc.createInvite('f1', 'c1', 'u1')).rejects.toThrow(ConflictException);
  });

  it('успех если device есть, но revoked', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', deletedAt: null });
    p._devices.push({ id: 'd1', childId: 'c1', revokedAt: new Date() });
    const svc = new InvitesService(p as unknown as PrismaService, cfg);
    const r = await svc.createInvite('f1', 'c1', 'u1');
    expect(r.code).toBeTruthy();
  });
});

describe('InvitesService.resetDevice', () => {
  it('revoke active device', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', deletedAt: null });
    p._devices.push({ id: 'd1', childId: 'c1', revokedAt: null });
    const svc = new InvitesService(p as unknown as PrismaService, cfg);
    await svc.resetDevice('f1', 'c1');
    expect(p._devices[0].revokedAt).not.toBeNull();
  });

  it('404 если нет active device', async () => {
    const p = makePrismaMock();
    p._children.push({ id: 'c1', familyId: 'f1', deletedAt: null });
    const svc = new InvitesService(p as unknown as PrismaService, cfg);
    await expect(svc.resetDevice('f1', 'c1')).rejects.toThrow(NotFoundException);
  });

  it('404 если child не в семье', async () => {
    const p = makePrismaMock();
    const svc = new InvitesService(p as unknown as PrismaService, cfg);
    await expect(svc.resetDevice('f1', 'c-missing')).rejects.toThrow(NotFoundException);
  });
});
