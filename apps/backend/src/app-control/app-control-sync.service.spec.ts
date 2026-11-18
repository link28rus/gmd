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
      childDevice: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'dev',
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
});
