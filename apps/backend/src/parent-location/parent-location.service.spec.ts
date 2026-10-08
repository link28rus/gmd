/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import {
  ParentLocationService,
  PARENT_ACCURACY_MAX_M,
  displayName,
} from './parent-location.service';

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

function makeService(
  o: Partial<{
    share: boolean | null; // null — пользователь не найден / удалён
    insertResult: number;
    device: any;
    verifyDevice: any;
    latestRows: any[];
    updateCount: number;
  }> = {},
) {
  const share = o.share === undefined ? true : o.share;
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue(share === null ? [] : [{ share }]),
    $executeRaw: jest.fn().mockResolvedValue(o.insertResult ?? 0),
    parentLocationDevice: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'pd-new' }),
    },
    user: { updateMany: jest.fn().mockResolvedValue({ count: o.updateCount ?? 1 }) },
    parentLocation: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
  const prisma: any = {
    tx,
    $transaction: jest.fn().mockImplementation((cb: (t: any) => Promise<unknown>) => cb(tx)),
    $queryRaw: jest.fn().mockResolvedValue(o.latestRows ?? []),
    parentLocationDevice: {
      findFirst: jest.fn().mockResolvedValue(o.verifyDevice ?? o.device ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    user: { findUnique: jest.fn() },
  };
  return { svc: new ParentLocationService(prisma), prisma, tx };
}

const ctx = { deviceId: 'pd1', userId: 'u1' };
const point = (msAgo: number, extra: Record<string, unknown> = {}) => ({
  lat: 48.48,
  lon: 135.08,
  recordedAt: new Date(Date.now() - msAgo).toISOString(),
  ...extra,
});

describe('ParentLocationService', () => {
  describe('createDevice', () => {
    it('выдаёт base64url-токен, в БД — sha256', async () => {
      const { svc, tx } = makeService();
      const r = await svc.createDevice('u1', { platform: 'android', appVersion: '0.70.0+1' });
      expect(r.deviceId).toBe('pd-new');
      expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(tx.parentLocationDevice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            userId: 'u1',
            tokenHash: sha256(r.token),
            platform: 'android',
            appVersion: '0.70.0+1',
          },
        }),
      );
      expect(tx.parentLocationDevice.updateMany).not.toHaveBeenCalled();
    });

    it('replaceDeviceId отзывает только своё устройство', async () => {
      const { svc, tx } = makeService();
      await svc.createDevice('u1', { replaceDeviceId: 'pd-old' });
      expect(tx.parentLocationDevice.updateMany).toHaveBeenCalledWith({
        where: { id: 'pd-old', userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('revokeDevice', () => {
    it('404 для чужого/неизвестного устройства', async () => {
      const { svc } = makeService({ device: null });
      await expect(svc.revokeDevice('u1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('уже отозванное — no-op', async () => {
      const { svc, prisma } = makeService({ device: { id: 'pd1', revokedAt: new Date() } });
      await svc.revokeDevice('u1', 'pd1');
      expect(prisma.parentLocationDevice.update).not.toHaveBeenCalled();
    });

    it('отзывает своё', async () => {
      const { svc, prisma } = makeService({ device: { id: 'pd1', revokedAt: null } });
      await svc.revokeDevice('u1', 'pd1');
      expect(prisma.parentLocationDevice.update).toHaveBeenCalledWith({
        where: { id: 'pd1' },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('verifyToken', () => {
    it('ищет по sha256 среди неотозванных', async () => {
      const { svc, prisma } = makeService({
        verifyDevice: { id: 'pd1', userId: 'u1', user: { deletedAt: null } },
      });
      expect(await svc.verifyToken('raw')).toEqual({ deviceId: 'pd1', userId: 'u1' });
      expect(prisma.parentLocationDevice.findFirst.mock.calls[0][0].where).toEqual({
        tokenHash: sha256('raw'),
        revokedAt: null,
      });
    });

    it('null для неизвестного токена и удалённого пользователя', async () => {
      expect(await makeService().svc.verifyToken('raw')).toBeNull();
      const { svc } = makeService({
        verifyDevice: { id: 'pd1', userId: 'u1', user: { deletedAt: new Date() } },
      });
      expect(await svc.verifyToken('raw')).toBeNull();
    });
  });

  describe('ingestPoints', () => {
    it('пишет валидные точки и обновляет lastSeenAt', async () => {
      const { svc, tx } = makeService({ insertResult: 2 });
      const r = await svc.ingestPoints(ctx, [point(60_000), point(30_000, { isMock: true })]);
      expect(r).toEqual({ accepted: 2, rejected: 0, sharingDisabled: false });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const sql = tx.$executeRaw.mock.calls[0][0];
      expect(sql.sql).toContain('ON CONFLICT ("deviceId","recordedAt") DO NOTHING');
      expect(sql.values).toContain(true); // isMock второй точки
      expect(tx.parentLocationDevice.update).toHaveBeenCalledWith({
        where: { id: 'pd1' },
        data: { lastSeenAt: expect.any(Date) },
      });
    });

    it('дубликаты (ON CONFLICT) считаются rejected', async () => {
      const { svc } = makeService({ insertResult: 1 });
      const r = await svc.ingestPoints(ctx, [point(60_000), point(60_000)]);
      expect(r).toEqual({ accepted: 1, rejected: 1, sharingDisabled: false });
    });

    it('отбрасывает точки вне окна и с accuracy > 500 м до INSERT', async () => {
      const { svc, tx } = makeService({ insertResult: 0 });
      const r = await svc.ingestPoints(ctx, [
        point(8 * 24 * 3600 * 1000),
        point(-3 * 60 * 1000),
        point(1000, { accuracy: PARENT_ACCURACY_MAX_M + 1 }),
      ]);
      expect(r).toEqual({ accepted: 0, rejected: 3, sharingDisabled: false });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      // lastSeenAt обновляется даже если ни одна точка не прошла фильтры
      expect(tx.parentLocationDevice.update).toHaveBeenCalled();
    });

    it('флаг выключен — ничего не пишет, sharingDisabled', async () => {
      const { svc, tx } = makeService({ share: false });
      const r = await svc.ingestPoints(ctx, [point(1000)]);
      expect(r).toEqual({ accepted: 0, rejected: 1, sharingDisabled: true });
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.$queryRaw.mock.calls[0][0].sql).toContain('FOR SHARE');
    });
  });

  describe('setSharing', () => {
    it('false — флаг и удаление точек в одной транзакции', async () => {
      const { svc, tx, prisma } = makeService();
      expect(await svc.setSharing('u1', false)).toEqual({ enabled: false });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', deletedAt: null },
        data: { shareLocationWithFamily: false },
      });
      expect(tx.parentLocation.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    });

    it('true — точки не трогает', async () => {
      const { svc, tx } = makeService();
      expect(await svc.setSharing('u1', true)).toEqual({ enabled: true });
      expect(tx.parentLocation.deleteMany).not.toHaveBeenCalled();
    });

    it('404 для удалённого пользователя', async () => {
      const { svc } = makeService({ updateCount: 0 });
      await expect(svc.setSharing('u1', true)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getLatestForFamily', () => {
    it('имя, isMe, ageSec', async () => {
      const recordedAt = new Date(Date.now() - 90_000);
      const { svc } = makeService({
        latestRows: [
          {
            userId: 'u1',
            name: null,
            firstName: 'Ольга',
            email: 'olga@x.ru',
            lat: 1,
            lon: 2,
            accuracy: 15,
            recordedAt,
          },
          {
            userId: 'u2',
            name: null,
            firstName: null,
            email: 'dad@x.ru',
            lat: 3,
            lon: 4,
            accuracy: null,
            recordedAt,
          },
        ],
      });
      const r = await svc.getLatestForFamily('f1', 'u1');
      expect(r[0]).toMatchObject({ userId: 'u1', name: 'Ольга', isMe: true, accuracy: 15 });
      expect(r[0].ageSec).toBeGreaterThanOrEqual(89);
      expect(r[0].recordedAt).toBe(recordedAt.toISOString());
      expect(r[1]).toMatchObject({ userId: 'u2', name: 'dad', isMe: false });
    });
  });

  it('displayName: name → firstName → email до @', () => {
    expect(displayName({ name: ' Мама ', firstName: 'Ольга', email: 'a@b' })).toBe('Мама');
    expect(displayName({ name: '  ', firstName: 'Ольга', email: 'a@b' })).toBe('Ольга');
    expect(displayName({ name: null, firstName: null, email: 'papa@b.ru' })).toBe('papa');
  });
});
