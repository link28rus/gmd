/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import {
  ParentLocationService,
  PARENT_ACCURACY_MAX_M,
  PARENT_OUT_OF_WINDOW_PAST_MS,
  SIGNAL_TTL_MS,
  displayName,
  isSignalLive,
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
    signal: { signalId: string | null; signalRequestedAt: Date | null; signalAckedAt: Date | null };
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
    $executeRaw: jest.fn().mockResolvedValue(o.insertResult ?? 0),
    parentLocationDevice: {
      findFirst: jest.fn().mockResolvedValue(o.verifyDevice ?? o.device ?? null),
      update: jest
        .fn()
        .mockResolvedValue(
          o.signal ?? { signalId: null, signalRequestedAt: null, signalAckedAt: null },
        ),
    },
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: o.updateCount ?? 1 }),
    },
    parentLocation: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
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
    const lastSeenOnly = {
      where: { id: 'pd1' },
      data: { lastSeenAt: expect.any(Date) },
      select: { signalId: true, signalRequestedAt: true, signalAckedAt: true },
    };

    it('пишет валидные точки и обновляет lastSeenAt', async () => {
      const { svc, prisma } = makeService({ insertResult: 2 });
      const r = await svc.ingestPoints(ctx, [point(60_000), point(30_000, { isMock: true })]);
      expect(r).toEqual({ accepted: 2, rejected: 0, sharingDisabled: false });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const sql = prisma.$executeRaw.mock.calls[0][0];
      expect(sql.sql).toContain('ON CONFLICT ("deviceId","recordedAt") DO NOTHING');
      expect(sql.values).toContain(true); // isMock второй точки
      expect(prisma.parentLocationDevice.update).toHaveBeenCalledWith(lastSeenOnly);
    });

    it('дубликаты (ON CONFLICT) считаются rejected', async () => {
      const { svc } = makeService({ insertResult: 1 });
      const r = await svc.ingestPoints(ctx, [point(60_000), point(60_000)]);
      expect(r).toEqual({ accepted: 1, rejected: 1, sharingDisabled: false });
    });

    it('отбрасывает точки вне окна и с accuracy > 500 м до INSERT', async () => {
      const { svc, prisma } = makeService({ insertResult: 0 });
      const r = await svc.ingestPoints(ctx, [
        point(PARENT_OUT_OF_WINDOW_PAST_MS + 60_000),
        point(-3 * 60 * 1000),
        point(1000, { accuracy: PARENT_ACCURACY_MAX_M + 1 }),
      ]);
      expect(r).toEqual({ accepted: 0, rejected: 3, sharingDisabled: false });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      // lastSeenAt обновляется даже если ни одна точка не прошла фильтры
      expect(prisma.parentLocationDevice.update).toHaveBeenCalled();
    });

    it('v0.73.1: точка недельной давности (офлайн-буфер) принимается', async () => {
      const { svc, prisma } = makeService({ insertResult: 1 });
      const r = await svc.ingestPoints(ctx, [point(20 * 24 * 3600 * 1000)]);
      expect(r.accepted).toBe(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('v0.73.0: флаг семьи не проверяется — точки пишутся всегда', async () => {
      const { svc, prisma, tx } = makeService({ share: false, insertResult: 1 });
      const r = await svc.ingestPoints(ctx, [point(1000)]);
      expect(r).toEqual({ accepted: 1, rejected: 0, sharingDisabled: false });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('сохраняет имя модели и push-токен устройства', async () => {
      const { svc, prisma } = makeService({ insertResult: 1 });
      await svc.ingestPoints(ctx, [point(1000)], { name: 'Xiaomi 2201', pushToken: 'fcm-1' });
      expect(prisma.parentLocationDevice.update).toHaveBeenCalledWith({
        ...lastSeenOnly,
        data: { lastSeenAt: expect.any(Date), deviceName: 'Xiaomi 2201', fcmToken: 'fcm-1' },
      });
    });

    it('живой сигнал приходит в ответе', async () => {
      const { svc } = makeService({
        insertResult: 1,
        signal: { signalId: 's1', signalRequestedAt: new Date(), signalAckedAt: null },
      });
      const r = await svc.ingestPoints(ctx, [point(1000)]);
      expect(r.signal).toEqual({ id: 's1' });
    });

    it('подтверждённый или просроченный сигнал не приходит', async () => {
      const acked = makeService({
        signal: { signalId: 's1', signalRequestedAt: new Date(), signalAckedAt: new Date() },
      });
      expect((await acked.svc.ingestPoints(ctx, [point(1000)])).signal).toBeUndefined();
      const old = makeService({
        signal: {
          signalId: 's1',
          signalRequestedAt: new Date(Date.now() - SIGNAL_TTL_MS - 1000),
          signalAckedAt: null,
        },
      });
      expect((await old.svc.ingestPoints(ctx, [point(1000)])).signal).toBeUndefined();
    });
  });

  it('isSignalLive: граница TTL', () => {
    const now = Date.now();
    const at = (ms: number) => ({
      signalId: 's',
      signalRequestedAt: new Date(now - ms),
      signalAckedAt: null,
    });
    expect(isSignalLive(at(SIGNAL_TTL_MS - 1), now)).toBe(true);
    expect(isSignalLive(at(SIGNAL_TTL_MS), now)).toBe(false);
    expect(isSignalLive({ ...at(0), signalId: null }, now)).toBe(false);
  });

  describe('setSharing', () => {
    it('v0.73.0: false — только флаг, точки остаются', async () => {
      const { svc, prisma } = makeService();
      expect(await svc.setSharing('u1', false)).toEqual({ enabled: false });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'u1', deletedAt: null },
        data: { shareLocationWithFamily: false },
      });
      expect(prisma.parentLocation.deleteMany).not.toHaveBeenCalled();
    });

    it('true — точки не трогает', async () => {
      const { svc, prisma } = makeService();
      expect(await svc.setSharing('u1', true)).toEqual({ enabled: true });
      expect(prisma.parentLocation.deleteMany).not.toHaveBeenCalled();
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
