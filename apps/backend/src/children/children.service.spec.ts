/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildrenService } from './children.service';
import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  _children: any[];
  _devices: any[];
  _invites: any[];
  _photos: any[];
  child: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  childDevice: { updateMany: jest.Mock };
  invite: { updateMany: jest.Mock };
  childAvatarPhoto: { upsert: jest.Mock; deleteMany: jest.Mock; findUnique: jest.Mock };
  $transaction: jest.Mock;
}

function makePrismaMock(): MockPrisma {
  const children: any[] = [];
  const devices: any[] = [];
  const invites: any[] = [];
  const photos: any[] = [];
  const api: MockPrisma = {
    _children: children,
    _devices: devices,
    _invites: invites,
    _photos: photos,
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
    childAvatarPhoto: {
      upsert: jest.fn(({ where, create, update }: any) => {
        const existing = photos.find((x) => x.childId === where.childId);
        if (existing) Object.assign(existing, update);
        else photos.push({ ...create });
        return Promise.resolve(existing ?? photos[photos.length - 1]);
      }),
      deleteMany: jest.fn(({ where }: any) => {
        const before = photos.length;
        for (let i = photos.length - 1; i >= 0; i--) {
          if (photos[i].childId === where.childId) photos.splice(i, 1);
        }
        return Promise.resolve({ count: before - photos.length });
      }),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(photos.find((x) => x.childId === where.childId) ?? null),
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

  it('listChildren возвращает только family и не-deleted, с device и protection', async () => {
    const p = makePrismaMock();
    const svc = new ChildrenService(p as unknown as PrismaService);
    const enabledAt = new Date();
    p._children.push(
      {
        id: 'c1',
        familyId: 'f1',
        name: 'A',
        deletedAt: null,
        protectionEnabled: true,
        protectionEnabledAt: enabledAt,
      },
      {
        id: 'c2',
        familyId: 'f1',
        name: 'B',
        deletedAt: new Date(),
        protectionEnabled: false,
        protectionEnabledAt: null,
      },
      {
        id: 'c3',
        familyId: 'f2',
        name: 'C',
        deletedAt: null,
        protectionEnabled: false,
        protectionEnabledAt: null,
      },
    );
    p._devices.push({ id: 'd1', childId: 'c1', revokedAt: null, deviceName: 'X' });
    const list = await svc.listChildren('f1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('c1');
    expect(list[0].device?.id).toBe('d1');
    expect(list[0].protectionEnabled).toBe(true);
    expect(list[0].protectionEnabledAt).toEqual(enabledAt);
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

  it('unbindDevice revoke device + consume invites, но НЕ ставит deletedAt', async () => {
    const p = makePrismaMock();
    const svc = new ChildrenService(p as unknown as PrismaService);
    p._children.push({ id: 'c1', familyId: 'f1', name: 'A', deletedAt: null });
    p._devices.push({ id: 'd1', childId: 'c1', revokedAt: null });
    p._invites.push({ id: 'i1', childId: 'c1', consumedAt: null });
    const r = await svc.unbindDevice('f1', 'c1');
    expect(r.unbound).toBe(true);
    expect(p._children[0].deletedAt).toBeNull();
    expect(p._devices[0].revokedAt).not.toBeNull();
    expect(p._invites[0].consumedAt).not.toBeNull();
  });

  it('unbindDevice unbound=false если активного устройства нет', async () => {
    const p = makePrismaMock();
    const svc = new ChildrenService(p as unknown as PrismaService);
    p._children.push({ id: 'c1', familyId: 'f1', name: 'A', deletedAt: null });
    const r = await svc.unbindDevice('f1', 'c1');
    expect(r.unbound).toBe(false);
  });

  it('unbindDevice 404 если child не в семье', async () => {
    const p = makePrismaMock();
    const svc = new ChildrenService(p as unknown as PrismaService);
    await expect(svc.unbindDevice('f1', 'missing')).rejects.toThrow(NotFoundException);
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

    it('setProtection enable=true → сохраняет enabled+At+By', async () => {
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
      const s = await svc.setProtection('f1', 'c1', true, 'u1');
      expect(s.enabled).toBe(true);
      expect(s.enabledBy).toBe('u1');
      expect(s.enabledAt).toBeInstanceOf(Date);
      expect(p._children[0].protectionEnabled).toBe(true);
    });

    it('setProtection enable=false зануляет At/By', async () => {
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

  describe('avatar', () => {
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const WEBP = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x10, 0, 0, 0]),
      Buffer.from('WEBPVP8 ', 'latin1'),
    ]);

    function setup() {
      const p = makePrismaMock();
      const svc = new ChildrenService(p as unknown as PrismaService);
      p._children.push({ id: 'c1', familyId: 'f1', name: 'A', deletedAt: null, avatarKey: null });
      return { p, svc };
    }

    it('preset → avatarKey preset:<id>, фото удаляется', async () => {
      const { p, svc } = setup();
      p._photos.push({ childId: 'c1', mime: 'image/jpeg', sha256: 'x', data: JPEG });
      const r = await svc.setAvatar('f1', 'c1', { preset: 'fox' });
      expect(r).toEqual({ avatarKey: 'preset:fox' });
      expect(p._children[0].avatarKey).toBe('preset:fox');
      expect(p._photos).toHaveLength(0);
      expect(p.$transaction).toHaveBeenCalledTimes(1);
    });

    it('неизвестный пресет → 400 invalid_avatar', async () => {
      const { p, svc } = setup();
      const call = svc.setAvatar('f1', 'c1', { preset: 'dragon' });
      await expect(call).rejects.toThrow(BadRequestException);
      await expect(call).rejects.toMatchObject({ response: { code: 'invalid_avatar' } });
      expect(p._children[0].avatarKey).toBeNull();
    });

    it('и preset, и photo сразу или пустое тело → 400 invalid_avatar', async () => {
      const { svc } = setup();
      await expect(
        svc.setAvatar('f1', 'c1', {
          preset: 'fox',
          photo: { mime: 'image/jpeg', base64: JPEG.toString('base64') },
        }),
      ).rejects.toMatchObject({ response: { code: 'invalid_avatar' } });
      await expect(svc.setAvatar('f1', 'c1', {})).rejects.toThrow(BadRequestException);
    });

    it('jpeg-фото → upsert + avatarKey photo:<12 hex sha256> в одной транзакции', async () => {
      const { p, svc } = setup();
      const sha = createHash('sha256').update(JPEG).digest('hex');
      const r = await svc.setAvatar('f1', 'c1', {
        photo: { mime: 'image/jpeg', base64: JPEG.toString('base64') },
      });
      expect(r).toEqual({ avatarKey: `photo:${sha.slice(0, 12)}` });
      expect(p._children[0].avatarKey).toBe(`photo:${sha.slice(0, 12)}`);
      expect(p._photos).toHaveLength(1);
      expect(p._photos[0]).toMatchObject({ childId: 'c1', mime: 'image/jpeg', sha256: sha });
      expect(Buffer.compare(p._photos[0].data, JPEG)).toBe(0);
      expect(p.$transaction).toHaveBeenCalledTimes(1);
    });

    it('png и webp с верной сигнатурой принимаются, повторная загрузка — upsert', async () => {
      const { p, svc } = setup();
      await svc.setAvatar('f1', 'c1', {
        photo: { mime: 'image/png', base64: PNG.toString('base64') },
      });
      await svc.setAvatar('f1', 'c1', {
        photo: { mime: 'image/webp', base64: WEBP.toString('base64') },
      });
      expect(p._photos).toHaveLength(1);
      expect(p._photos[0].mime).toBe('image/webp');
    });

    it('сигнатура не совпадает с mime → 400 invalid_avatar', async () => {
      const { p, svc } = setup();
      await expect(
        svc.setAvatar('f1', 'c1', {
          photo: { mime: 'image/png', base64: JPEG.toString('base64') },
        }),
      ).rejects.toMatchObject({ response: { code: 'invalid_avatar' } });
      expect(p._photos).toHaveLength(0);
    });

    it('не base64 → 400 invalid_avatar', async () => {
      const { svc } = setup();
      await expect(
        svc.setAvatar('f1', 'c1', { photo: { mime: 'image/jpeg', base64: '%%% not base64' } }),
      ).rejects.toMatchObject({ response: { code: 'invalid_avatar' } });
    });

    it('больше 300 КБ → 413 avatar_too_large', async () => {
      const { p, svc } = setup();
      const big = Buffer.alloc(300 * 1024 + 1, 0);
      JPEG.copy(big);
      const call = svc.setAvatar('f1', 'c1', {
        photo: { mime: 'image/jpeg', base64: big.toString('base64') },
      });
      await expect(call).rejects.toThrow(PayloadTooLargeException);
      await expect(call).rejects.toMatchObject({ response: { code: 'avatar_too_large' } });
      expect(p._photos).toHaveLength(0);
    });

    it('ровно 300 КБ принимается', async () => {
      const { p, svc } = setup();
      const max = Buffer.alloc(300 * 1024, 0);
      JPEG.copy(max);
      await svc.setAvatar('f1', 'c1', {
        photo: { mime: 'image/jpeg', base64: max.toString('base64') },
      });
      expect(p._photos).toHaveLength(1);
    });

    it('setAvatar для ребёнка чужой семьи → 404', async () => {
      const { svc } = setup();
      await expect(svc.setAvatar('f2', 'c1', { preset: 'fox' })).rejects.toThrow(NotFoundException);
    });

    it('removeAvatar → avatarKey null + фото удалено', async () => {
      const { p, svc } = setup();
      p._children[0].avatarKey = 'photo:abcdef012345';
      p._photos.push({ childId: 'c1', mime: 'image/jpeg', sha256: 'x', data: JPEG });
      await svc.removeAvatar('f1', 'c1');
      expect(p._children[0].avatarKey).toBeNull();
      expect(p._photos).toHaveLength(0);
    });

    it('getAvatarPhoto отдаёт байты, mime и sha256', async () => {
      const { p, svc } = setup();
      p._photos.push({ childId: 'c1', mime: 'image/jpeg', sha256: 'abc', data: JPEG });
      const r = await svc.getAvatarPhoto('f1', 'c1');
      expect(r.mime).toBe('image/jpeg');
      expect(r.sha256).toBe('abc');
      expect(Buffer.compare(r.data, JPEG)).toBe(0);
    });

    it('getAvatarPhoto чужой семьи → 404 child_not_found, фото не читается', async () => {
      const { p, svc } = setup();
      p._photos.push({ childId: 'c1', mime: 'image/jpeg', sha256: 'abc', data: JPEG });
      await expect(svc.getAvatarPhoto('f2', 'c1')).rejects.toMatchObject({
        response: { code: 'child_not_found' },
      });
      expect(p.childAvatarPhoto.findUnique).not.toHaveBeenCalled();
    });

    it('getAvatarPhoto удалённого ребёнка → 404', async () => {
      const { p, svc } = setup();
      p._children[0].deletedAt = new Date();
      p._photos.push({ childId: 'c1', mime: 'image/jpeg', sha256: 'abc', data: JPEG });
      await expect(svc.getAvatarPhoto('f1', 'c1')).rejects.toThrow(NotFoundException);
    });

    it('getAvatarPhoto без фото → 404 avatar_not_found', async () => {
      const { svc } = setup();
      await expect(svc.getAvatarPhoto('f1', 'c1')).rejects.toMatchObject({
        response: { code: 'avatar_not_found' },
      });
    });

    it('listChildren отдаёт avatarKey', async () => {
      const { p, svc } = setup();
      p._children[0].avatarKey = 'preset:owl';
      const list = await svc.listChildren('f1');
      expect(list[0].avatarKey).toBe('preset:owl');
    });
  });
});
