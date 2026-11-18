import { UnauthorizedException } from '@nestjs/common';
import { AppControlSyncService, configRevision } from './app-control-sync.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AppBlockingService } from './app-blocking.service';
import type { ScheduleService } from './schedule.service';

describe('Синхронизация контроля приложений', () => {
  const state = {
    session: null,
    rules: [{ packageName: 'a', mode: 'DEFAULT', source: 'PARENT' }],
    schedules: [],
  };
  it('повтор одного снимка имеет ту же revision; изменение правила и привязки меняет revision', () => {
    expect(configRevision('binding', state)).toBe(
      configRevision('binding', structuredClone(state)),
    );
    expect(configRevision('other', state)).not.toBe(configRevision('binding', state));
    expect(configRevision('binding', { ...state, rules: [] })).not.toBe(
      configRevision('binding', state),
    );
  });
  function setup(ack: unknown = null) {
    const db = {
      zone: { findMany: jest.fn().mockResolvedValue([]) },
      childDevice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'dev',
          childId: 'child',
          child: { familyId: 'family' },
          tokenHash: 'binding',
          timezone: 'Asia/Vladivostok',
          appControlStatus: ack,
          usageReportedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const blocking = {
      getActiveSessionByDevice: jest.fn().mockResolvedValue(null),
      listEffectiveRules: jest.fn().mockResolvedValue(state.rules),
    };
    const schedules = { listForDevice: jest.fn().mockResolvedValue([]) };
    return {
      db,
      service: new AppControlSyncService(
        db as unknown as PrismaService,
        blocking as unknown as AppBlockingService,
        schedules as unknown as ScheduleService,
      ),
    };
  }
  it('отсутствие подтверждения не выдаётся за применённые правила', async () => {
    const { service } = setup();
    expect(await service.status('child')).toMatchObject({
      applied: false,
      reportedAt: null,
      accessibility: null,
    });
  });
  it('запоздавшее подтверждение старой конфигурации не подтверждает новую', async () => {
    const { service } = setup({
      revision: 'old',
      bindingHash: 'binding',
      receivedAt: new Date().toISOString(),
      accessibility: true,
      usageStats: true,
    });
    expect(await service.status('child')).toMatchObject({ applied: false });
  });
  it('подтверждение текущей конфигурации требует работающей службы блокировки', async () => {
    const { service } = setup({
      revision: configRevision('binding', state),
      bindingHash: 'binding',
      receivedAt: new Date().toISOString(),
      accessibility: false,
      usageStats: true,
    });
    expect(await service.status('child')).toMatchObject({ applied: false, accessibility: false });
  });
  it('совпадающий свежий снимок с подключённой службой подтверждён', async () => {
    const { service } = setup({
      revision: configRevision('binding', state),
      bindingHash: 'binding',
      receivedAt: new Date().toISOString(),
      accessibility: true,
      usageStats: true,
    });
    expect(await service.status('child')).toMatchObject({ applied: true });
  });
  it('отозванный между guard и записью токен не подтверждает новый телефон', async () => {
    const { db, service } = setup();
    db.childDevice.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.ack('dev', 'retired', {
        revision: 'a'.repeat(64),
        accessibility: true,
        usageStats: true,
        timezone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('отдаёт только геометрию действующих зон семьи, назначенных этому ребёнку', async () => {
    const { db, service } = setup();
    const zone = { id: 'school', name: 'Школа', centerLat: 48, centerLon: 135, radius: 150 };
    db.zone.findMany.mockResolvedValue([zone]);

    expect(await service.get('dev', 'token')).toMatchObject({ blockingZones: [zone] });
    expect(db.zone.findMany).toHaveBeenCalledWith({
      where: {
        familyId: 'family',
        deletedAt: null,
        blockApps: true,
        OR: [{ allChildren: true }, { assignments: { some: { childId: 'child' } } }],
      },
      select: { id: true, name: true, centerLat: true, centerLon: true, radius: true },
      orderBy: { id: 'asc' },
    });
  });

  it('подтверждение старого APK не подтверждает правила блокировки по зонам', async () => {
    const blockingZones = [
      { id: 'school', name: 'Школа', centerLat: 48, centerLon: 135, radius: 150 },
    ];
    const ack = {
      revision: configRevision('binding', { ...state, blockingZones }),
      bindingHash: 'binding',
      receivedAt: new Date().toISOString(),
      accessibility: true,
    };
    const { db, service } = setup(ack);
    db.zone.findMany.mockResolvedValue(blockingZones);
    expect(await service.status('child')).toMatchObject({ applied: false });
    Object.assign(ack, { zoneBlockingSupported: true });
    expect(await service.status('child')).toMatchObject({ applied: true });
  });
});
