import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppBlockingService } from './app-blocking.service';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';

interface PrismaMock {
  childDevice: { findFirst: jest.Mock };
  blockSession: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  appRule: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
  };
}

interface FcmMock {
  sendDataMessage: jest.Mock;
  sendHybridDataMessage: jest.Mock;
}

function makePrisma(): PrismaMock {
  return {
    childDevice: { findFirst: jest.fn() },
    blockSession: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    appRule: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
    },
  };
}

function makeFcm(): FcmMock {
  return {
    sendDataMessage: jest.fn().mockResolvedValue(true),
    sendHybridDataMessage: jest.fn().mockResolvedValue(true),
  };
}

async function buildService(prisma: PrismaMock, fcm: FcmMock): Promise<AppBlockingService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AppBlockingService,
      { provide: PrismaService, useValue: prisma },
      { provide: FcmService, useValue: fcm },
    ],
  }).compile();
  return moduleRef.get(AppBlockingService);
}

describe('AppBlockingService', () => {
  describe('createSession', () => {
    it('создаёт ACTIVE сессию + шлёт FCM BLOCK_APPS', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.childDevice.findFirst.mockResolvedValue({
        id: 'dev1',
        fcmToken: 'tok1',
        rustorePushToken: null,
      });
      prisma.blockSession.findFirst.mockResolvedValue(null);
      prisma.blockSession.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'sess1', ...data }),
      );
      const svc = await buildService(prisma, fcm);

      const res = await svc.createSession({
        childId: 'c1',
        createdByUserId: 'u1',
        durationMin: 30,
      });

      expect(res.sessionId).toBe('sess1');
      expect(res.endsAt.getTime() - res.startedAt.getTime()).toBe(30 * 60_000);
      expect(prisma.blockSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          childDeviceId: 'dev1',
          createdByUserId: 'u1',
          state: 'ACTIVE',
        }),
      });
      // FCM шлётся fire-and-forget — даём микротаску завершиться
      await new Promise((r) => setImmediate(r));
      expect(fcm.sendHybridDataMessage).toHaveBeenCalledWith(
        'dev1',
        { fcmToken: 'tok1', rustorePushToken: null },
        expect.objectContaining({ type: 'BLOCK_APPS', sessionId: 'sess1' }),
      );
    });

    it('отказывает 409 если уже есть активная сессия', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.childDevice.findFirst.mockResolvedValue({
        id: 'dev1',
        fcmToken: null,
        rustorePushToken: null,
      });
      prisma.blockSession.findFirst.mockResolvedValue({
        id: 'sess_existing',
        endsAt: new Date(Date.now() + 60_000),
      });
      const svc = await buildService(prisma, fcm);

      await expect(
        svc.createSession({ childId: 'c1', createdByUserId: 'u1', durationMin: 60 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.blockSession.create).not.toHaveBeenCalled();
      expect(fcm.sendHybridDataMessage).not.toHaveBeenCalled();
    });

    it('404 no_active_device если у ребёнка нет устройства', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.childDevice.findFirst.mockResolvedValue(null);
      const svc = await buildService(prisma, fcm);

      await expect(
        svc.createSession({ childId: 'c1', createdByUserId: 'u1', durationMin: 60 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('stopSession', () => {
    it('переводит ACTIVE → ENDED + шлёт FCM UNBLOCK_APPS', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.blockSession.findUnique.mockResolvedValue({
        id: 'sess1',
        childDeviceId: 'dev1',
        state: 'ACTIVE',
        childDevice: { childId: 'c1', fcmToken: 'tok1', rustorePushToken: null },
      });
      prisma.blockSession.update.mockResolvedValue({});
      const svc = await buildService(prisma, fcm);

      await svc.stopSession({ childId: 'c1', sessionId: 'sess1', stoppedByUserId: 'u1' });

      expect(prisma.blockSession.update).toHaveBeenCalledWith({
        where: { id: 'sess1' },
        data: expect.objectContaining({ state: 'ENDED', endReason: 'PARENT_STOPPED' }),
      });
      await new Promise((r) => setImmediate(r));
      expect(fcm.sendHybridDataMessage).toHaveBeenCalledWith(
        'dev1',
        { fcmToken: 'tok1', rustorePushToken: null },
        expect.objectContaining({ type: 'UNBLOCK_APPS', sessionId: 'sess1' }),
      );
    });

    it('идемпотентно для уже ENDED сессии — не делает update', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.blockSession.findUnique.mockResolvedValue({
        id: 'sess1',
        childDeviceId: 'dev1',
        state: 'ENDED',
        childDevice: { childId: 'c1', fcmToken: 'tok1', rustorePushToken: null },
      });
      const svc = await buildService(prisma, fcm);

      await svc.stopSession({ childId: 'c1', sessionId: 'sess1', stoppedByUserId: 'u1' });

      expect(prisma.blockSession.update).not.toHaveBeenCalled();
      expect(fcm.sendHybridDataMessage).not.toHaveBeenCalled();
    });

    it('403 при попытке stop сессии чужого ребёнка', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.blockSession.findUnique.mockResolvedValue({
        id: 'sess1',
        childDeviceId: 'dev_other',
        state: 'ACTIVE',
        childDevice: { childId: 'OTHER_CHILD', fcmToken: null, rustorePushToken: null },
      });
      const svc = await buildService(prisma, fcm);

      await expect(
        svc.stopSession({ childId: 'c1', sessionId: 'sess1', stoppedByUserId: 'u1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 если сессия не найдена', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.blockSession.findUnique.mockResolvedValue(null);
      const svc = await buildService(prisma, fcm);

      await expect(
        svc.stopSession({ childId: 'c1', sessionId: 'sess_missing', stoppedByUserId: 'u1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getActiveSession / getActiveSessionByDevice', () => {
    it('возвращает null когда нет ACTIVE сессии', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.childDevice.findFirst.mockResolvedValue({ id: 'dev1' });
      prisma.blockSession.findFirst.mockResolvedValue(null);
      const svc = await buildService(prisma, fcm);

      await expect(svc.getActiveSession('c1')).resolves.toBeNull();
    });

    it('auto-expire on read когда endsAt прошёл', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      const past = new Date(Date.now() - 60_000);
      prisma.blockSession.findFirst.mockResolvedValue({
        id: 'sess1',
        endsAt: past,
        startedAt: new Date(past.getTime() - 60_000),
        state: 'ACTIVE',
      });
      prisma.blockSession.update.mockResolvedValue({});
      const svc = await buildService(prisma, fcm);

      await expect(svc.getActiveSessionByDevice('dev1')).resolves.toBeNull();
      expect(prisma.blockSession.update).toHaveBeenCalledWith({
        where: { id: 'sess1' },
        data: expect.objectContaining({ state: 'EXPIRED', endReason: 'EXPIRED' }),
      });
    });
  });

  describe('upsertParentRule', () => {
    it('UPSERT + FCM SYNC_RULES', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.childDevice.findFirst.mockResolvedValue({
        id: 'dev1',
        fcmToken: 'tok1',
        rustorePushToken: null,
      });
      prisma.appRule.upsert.mockResolvedValue({
        id: 'r1',
        packageName: 'com.tiktok',
        mode: 'ALWAYS_ALLOWED',
        source: 'PARENT',
      });
      const svc = await buildService(prisma, fcm);

      const r = await svc.upsertParentRule({
        childId: 'c1',
        packageName: 'com.tiktok',
        mode: 'ALWAYS_ALLOWED',
      });

      expect(r.source).toBe('PARENT');
      expect(prisma.appRule.upsert).toHaveBeenCalledWith({
        where: { childDeviceId_packageName: { childDeviceId: 'dev1', packageName: 'com.tiktok' } },
        create: expect.objectContaining({ mode: 'ALWAYS_ALLOWED', source: 'PARENT' }),
        update: expect.objectContaining({ mode: 'ALWAYS_ALLOWED', source: 'PARENT' }),
      });
      await new Promise((r) => setImmediate(r));
      expect(fcm.sendHybridDataMessage).toHaveBeenCalledWith(
        'dev1',
        { fcmToken: 'tok1', rustorePushToken: null },
        expect.objectContaining({ type: 'SYNC_RULES' }),
      );
    });
  });

  describe('upsertSystemDefaults', () => {
    it('пропускает packages с существующим PARENT-правилом', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.appRule.findMany.mockResolvedValue([{ packageName: 'com.parent.set' }]);
      prisma.appRule.upsert.mockResolvedValue({});
      const svc = await buildService(prisma, fcm);

      const res = await svc.upsertSystemDefaults('dev1', ['com.parent.set', 'com.android.dialer']);

      expect(res.count).toBe(1); // только dialer заupserted
      expect(prisma.appRule.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.appRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ packageName: 'com.android.dialer' }),
        }),
      );
    });

    it('пустой список — count=0, ноль вызовов', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      const svc = await buildService(prisma, fcm);
      const res = await svc.upsertSystemDefaults('dev1', []);
      expect(res.count).toBe(0);
      expect(prisma.appRule.upsert).not.toHaveBeenCalled();
    });
  });

  describe('listEffectiveRules', () => {
    it('всегда возвращает HARDCODED первыми + DB-правила', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.appRule.findMany.mockResolvedValue([
        { packageName: 'com.tiktok', mode: 'DEFAULT', source: 'PARENT' },
        { packageName: 'com.android.dialer', mode: 'ALWAYS_ALLOWED', source: 'SYSTEM_DEFAULT' },
      ]);
      const svc = await buildService(prisma, fcm);

      const rules = await svc.listEffectiveRules('dev1');

      // hardcoded в начале
      expect(rules[0]).toEqual({
        packageName: 'ru.link28rus.gmd.child',
        mode: 'ALWAYS_ALLOWED',
        source: 'HARDCODED',
      });
      expect(rules[1]).toEqual({
        packageName: 'ru.oneme.app',
        mode: 'ALWAYS_ALLOWED',
        source: 'HARDCODED',
      });
      // затем DB-правила
      expect(rules.find((r) => r.packageName === 'com.tiktok')?.source).toBe('PARENT');
      expect(rules.find((r) => r.packageName === 'com.android.dialer')?.source).toBe(
        'SYSTEM_DEFAULT',
      );
    });

    it('игнорирует попытку перезаписать HARDCODED через PARENT', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.appRule.findMany.mockResolvedValue([
        { packageName: 'ru.link28rus.gmd.child', mode: 'ALWAYS_BLOCKED', source: 'PARENT' },
      ]);
      const svc = await buildService(prisma, fcm);

      const rules = await svc.listEffectiveRules('dev1');
      const ours = rules.filter((r) => r.packageName === 'ru.link28rus.gmd.child');
      expect(ours).toHaveLength(1);
      expect(ours[0].mode).toBe('ALWAYS_ALLOWED');
      expect(ours[0].source).toBe('HARDCODED');
    });
  });

  describe('onModuleInit', () => {
    it('expires stale ACTIVE сессий с истёкшим endsAt', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.blockSession.updateMany.mockResolvedValue({ count: 3 });
      const svc = await buildService(prisma, fcm);

      await svc.onModuleInit();

      expect(prisma.blockSession.updateMany).toHaveBeenCalledWith({
        where: { state: 'ACTIVE', endsAt: { lte: expect.any(Date) } },
        data: expect.objectContaining({ state: 'EXPIRED', endReason: 'EXPIRED' }),
      });
    });

    it('не падает при ошибке cleanup', async () => {
      const prisma = makePrisma();
      const fcm = makeFcm();
      prisma.blockSession.updateMany.mockRejectedValue(new Error('db down'));
      const svc = await buildService(prisma, fcm);

      await expect(svc.onModuleInit()).resolves.toBeUndefined();
    });
  });
});
