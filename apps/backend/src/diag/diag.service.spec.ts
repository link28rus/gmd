/* eslint-disable @typescript-eslint/no-explicit-any */
import { NotFoundException } from '@nestjs/common';
import {
  DiagService,
  DIAG_MAX_UPLOADS_PER_DEVICE,
  DIAG_REQUEST_TTL_MS,
  DIAG_RETENTION_MS,
} from './diag.service';
import { DEFAULT_DIAG_CONFIG, normalizeDiagConfig } from './diag-config';
import { DiagConfigSchema, UploadDiagLogSchema } from './dto/diag.dto';
import type { PrismaService } from '../prisma/prisma.service';
import type { FcmService } from '../fcm/fcm.service';
import type { ChildRealtimeService } from '../child-realtime/child-realtime.service';

const DAY = 24 * 60 * 60 * 1000;

interface Upload {
  id: string;
  childDeviceId: string;
  childId: string;
  createdAt: Date;
  [k: string]: unknown;
}

interface Cmd {
  id: string;
  childDeviceId: string;
  type: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  executedAt?: Date | null;
  createdByUserId?: string;
}

interface Device {
  id: string;
  childId: string;
  revokedAt: Date | null;
  diagConfig: unknown;
  appVersion: string | null;
  lastSeenAt: Date | null;
  fcmToken: string | null;
  rustorePushToken: string | null;
}

function createPrismaMock(init: { devices?: Device[]; commands?: Cmd[]; uploads?: Upload[] }) {
  const devices = init.devices ?? [];
  const commands = init.commands ?? [];
  const uploads = init.uploads ?? [];
  let seq = 0;

  const cmdMatches = (c: Cmd, where: any): boolean => {
    if (where.id && c.id !== where.id) return false;
    if (where.childDeviceId && c.childDeviceId !== where.childDeviceId) return false;
    if (where.type && c.type !== where.type) return false;
    if (where.status && c.status !== where.status) return false;
    if (where.expiresAt?.gt && !(c.expiresAt > where.expiresAt.gt)) return false;
    return true;
  };

  const prisma = {
    _devices: devices,
    _commands: commands,
    _uploads: uploads,
    child: {
      findUnique: jest.fn(async ({ where }: any) =>
        devices.some((d) => d.childId === where.id) || where.id === 'child-no-device'
          ? { id: where.id }
          : null,
      ),
    },
    childDevice: {
      findUnique: jest.fn(async ({ where }: any) => devices.find((d) => d.id === where.id) ?? null),
      findFirst: jest.fn(
        async ({ where }: any) =>
          devices.find(
            (d) => d.childId === where.childId && (where.revokedAt !== null || !d.revokedAt),
          ) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const d = devices.find((x) => x.id === where.id)!;
        Object.assign(d, data);
        return d;
      }),
    },
    deviceCommand: {
      findFirst: jest.fn(async ({ where }: any) => {
        const res = commands
          .filter((c) => cmdMatches(c, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return res[0] ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const c: Cmd = { id: `cmd-${++seq}`, createdAt: new Date(), ...data };
        commands.push(c);
        return c;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const c of commands) {
          if (cmdMatches(c, where)) {
            Object.assign(c, data);
            count++;
          }
        }
        return { count };
      }),
    },
    diagLogUpload: {
      create: jest.fn(async ({ data }: any) => {
        const u: Upload = { id: `up-${++seq}`, createdAt: new Date(), ...data };
        uploads.push(u);
        return { id: u.id };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const keep = uploads.filter((u) => {
          if (where.id?.in) return !where.id.in.includes(u.id);
          if (where.id) return u.id !== where.id;
          if (where.createdAt?.lt) return !(u.createdAt < where.createdAt.lt);
          return true;
        });
        const count = uploads.length - keep.length;
        uploads.splice(0, uploads.length, ...keep);
        return { count };
      }),
      findMany: jest.fn(async ({ where, orderBy, skip, take }: any) => {
        let res = uploads.filter(
          (u) =>
            (!where.childDeviceId || u.childDeviceId === where.childDeviceId) &&
            (!where.childId || u.childId === where.childId),
        );
        if (orderBy?.createdAt === 'desc') {
          res = [...res].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        res = res.slice(skip ?? 0, take ? (skip ?? 0) + take : undefined);
        return res.map((u) => ({ ...u }));
      }),
      findUnique: jest.fn(async ({ where }: any) => uploads.find((u) => u.id === where.id) ?? null),
    },
  };
  return prisma;
}

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'dev-1',
    childId: 'child-1',
    revokedAt: null,
    diagConfig: null,
    appVersion: '0.60.0+1',
    lastSeenAt: new Date('2026-09-29T10:00:00Z'),
    fcmToken: 'fcm-token-xxxxxxxx',
    rustorePushToken: null,
    ...over,
  };
}

function makeService(prisma: ReturnType<typeof createPrismaMock>, opts: { rt?: boolean } = {}) {
  const connected: Array<(id: string) => void> = [];
  const realtime = {
    onDeviceConnected: jest.fn((cb: (id: string) => void) => connected.push(cb)),
    sendWithAck: jest.fn().mockResolvedValue(opts.rt ?? false),
    isConnected: jest.fn().mockReturnValue(opts.rt ?? false),
  };
  const fcm = { sendHybridDataMessage: jest.fn().mockResolvedValue(opts.rt ?? false) };
  const svc = new DiagService(
    prisma as unknown as PrismaService,
    fcm as unknown as FcmService,
    realtime as unknown as ChildRealtimeService,
  );
  return { svc, realtime, fcm, connected };
}

describe('normalizeDiagConfig', () => {
  it('null / не объект → умолчания', () => {
    expect(normalizeDiagConfig(null)).toEqual(DEFAULT_DIAG_CONFIG);
    expect(normalizeDiagConfig('x')).toEqual(DEFAULT_DIAG_CONFIG);
    expect(normalizeDiagConfig([1, 2])).toEqual(DEFAULT_DIAG_CONFIG);
  });

  it('пропущенные поля — умолчания, неизвестные категории отбрасываются', () => {
    const cfg = normalizeDiagConfig({
      send: ['audio', 'bogus', 'audio', 'push', 42],
      debug: ['realtime', 'nope'],
      logcat: true,
      autoUpload: 'yes',
    });
    expect(cfg).toEqual({
      send: ['audio', 'push'],
      debug: ['realtime'],
      debugUntil: null,
      logcat: true,
      snapshot: true,
      autoUpload: true,
    });
  });

  it('пустой send сохраняется, debugUntil нормализуется в ISO, мусор → null', () => {
    expect(normalizeDiagConfig({ send: [] }).send).toEqual([]);
    expect(normalizeDiagConfig({ debugUntil: '2026-09-30T12:00:00+03:00' }).debugUntil).toBe(
      '2026-09-30T09:00:00.000Z',
    );
    expect(normalizeDiagConfig({ debugUntil: 'завтра' }).debugUntil).toBeNull();
  });

  it('умолчания не разделяют массивы между вызовами', () => {
    const a = normalizeDiagConfig(null);
    a.send.pop();
    expect(normalizeDiagConfig(null).send).toHaveLength(7);
  });
});

describe('DTO', () => {
  it('DiagConfigSchema — полный объект, strict, известные категории', () => {
    const ok = {
      send: ['audio'],
      debug: [],
      debugUntil: null,
      logcat: false,
      snapshot: true,
      autoUpload: true,
    };
    expect(DiagConfigSchema.safeParse(ok).success).toBe(true);
    expect(DiagConfigSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(DiagConfigSchema.safeParse({ ...ok, send: ['bogus'] }).success).toBe(false);
    const partial: Partial<typeof ok> = { ...ok };
    delete partial.autoUpload;
    expect(DiagConfigSchema.safeParse(partial).success).toBe(false);
    expect(DiagConfigSchema.safeParse({ ...ok, debugUntil: 'не дата' }).success).toBe(false);
  });

  it('UploadDiagLogSchema — лимиты и необязательные поля', () => {
    const r = UploadDiagLogSchema.parse({ reason: 'auto', trigger: 'crash', log: 'x' });
    expect(r).toMatchObject({ reason: 'auto', trigger: 'crash', commandId: null, logcat: null });
    expect(UploadDiagLogSchema.safeParse({ reason: 'other' }).success).toBe(false);
    expect(UploadDiagLogSchema.safeParse({ reason: 'auto', trigger: 'x'.repeat(65) }).success).toBe(
      false,
    );
    expect(
      UploadDiagLogSchema.safeParse({ reason: 'auto', appVersion: '1'.repeat(33) }).success,
    ).toBe(false);
    expect(
      UploadDiagLogSchema.safeParse({ reason: 'auto', snapshot: 's'.repeat(64 * 1024 + 1) })
        .success,
    ).toBe(false);
  });
});

describe('DiagService.requestUpload', () => {
  it('создаёт UPLOAD_DIAG с TTL 24 ч и шлёт {type, commandId}', async () => {
    const prisma = createPrismaMock({ devices: [device()] });
    const { svc, fcm } = makeService(prisma, { rt: true });
    const before = Date.now();
    const res = await svc.requestUpload('child-1', 'admin-1');

    expect(prisma._commands).toHaveLength(1);
    const cmd = prisma._commands[0];
    expect(cmd).toMatchObject({
      type: 'UPLOAD_DIAG',
      status: 'pending',
      createdByUserId: 'admin-1',
    });
    expect(cmd.expiresAt.getTime() - before).toBeGreaterThanOrEqual(DIAG_REQUEST_TTL_MS - 1000);
    expect(cmd.expiresAt.getTime() - before).toBeLessThanOrEqual(DIAG_REQUEST_TTL_MS + 1000);
    expect(fcm.sendHybridDataMessage).toHaveBeenCalledWith(
      'dev-1',
      { fcmToken: 'fcm-token-xxxxxxxx', rustorePushToken: null },
      { type: 'UPLOAD_DIAG', commandId: cmd.id },
    );
    expect(res).toEqual({
      commandId: cmd.id,
      delivered: true,
      expiresAt: cmd.expiresAt.toISOString(),
    });
  });

  it('живой pending-запрос переиспользуется, но push уходит повторно', async () => {
    const live: Cmd = {
      id: 'cmd-live',
      childDeviceId: 'dev-1',
      type: 'UPLOAD_DIAG',
      status: 'pending',
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + DAY),
    };
    const prisma = createPrismaMock({ devices: [device()], commands: [live] });
    const { svc, fcm } = makeService(prisma);
    const res = await svc.requestUpload('child-1', 'admin-1');
    expect(res.commandId).toBe('cmd-live');
    expect(res.delivered).toBe(false);
    expect(prisma.deviceCommand.create).not.toHaveBeenCalled();
    expect(fcm.sendHybridDataMessage).toHaveBeenCalledTimes(1);
  });

  it('истёкший или выполненный запрос не мешает создать новый', async () => {
    const prisma = createPrismaMock({
      devices: [device()],
      commands: [
        {
          id: 'old-expired',
          childDeviceId: 'dev-1',
          type: 'UPLOAD_DIAG',
          status: 'pending',
          createdAt: new Date(Date.now() - 2 * DAY),
          expiresAt: new Date(Date.now() - DAY),
        },
        {
          id: 'old-done',
          childDeviceId: 'dev-1',
          type: 'UPLOAD_DIAG',
          status: 'executed',
          createdAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() + DAY),
        },
      ],
    });
    const { svc } = makeService(prisma);
    const res = await svc.requestUpload('child-1', 'admin-1');
    expect(['old-expired', 'old-done']).not.toContain(res.commandId);
    expect(prisma.deviceCommand.create).toHaveBeenCalledTimes(1);
  });

  it('нет активного устройства → 404 no_active_device', async () => {
    const prisma = createPrismaMock({ devices: [device({ revokedAt: new Date() })] });
    const { svc } = makeService(prisma);
    await expect(svc.requestUpload('child-1', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.requestUpload('child-1', 'admin-1')).rejects.toMatchObject({
      response: { code: 'no_active_device' },
    });
  });
});

describe('DiagService.saveUpload', () => {
  it('sizeBytes = сумма UTF-8 длин, команда этого устройства → executed', async () => {
    const pending: Cmd = {
      id: 'cmd-1',
      childDeviceId: 'dev-1',
      type: 'UPLOAD_DIAG',
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + DAY),
    };
    const prisma = createPrismaMock({ devices: [device()], commands: [pending] });
    const { svc } = makeService(prisma);
    const dto = UploadDiagLogSchema.parse({
      reason: 'manual',
      commandId: 'cmd-1',
      appVersion: '0.60.0+1',
      snapshot: 'ab',
      log: 'жж', // 4 байта
      logcat: null,
    });
    const res = await svc.saveUpload({ deviceId: 'dev-1', childId: 'child-1' }, dto);
    expect(res.id).toMatch(/^up-/);
    expect(prisma._uploads[0]).toMatchObject({
      childDeviceId: 'dev-1',
      childId: 'child-1',
      reason: 'manual',
      commandId: 'cmd-1',
      sizeBytes: 6,
      logcat: null,
    });
    expect(pending.status).toBe('executed');
    expect(pending.executedAt).toBeInstanceOf(Date);
  });

  it('commandId чужого устройства или другого типа не трогается', async () => {
    const foreign: Cmd = {
      id: 'cmd-foreign',
      childDeviceId: 'dev-2',
      type: 'UPLOAD_DIAG',
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + DAY),
    };
    const audio: Cmd = {
      id: 'cmd-audio',
      childDeviceId: 'dev-1',
      type: 'START_AUDIO',
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + DAY),
    };
    const prisma = createPrismaMock({ devices: [device()], commands: [foreign, audio] });
    const { svc } = makeService(prisma);
    await svc.saveUpload(
      { deviceId: 'dev-1', childId: 'child-1' },
      UploadDiagLogSchema.parse({ reason: 'manual', commandId: 'cmd-foreign' }),
    );
    await svc.saveUpload(
      { deviceId: 'dev-1', childId: 'child-1' },
      UploadDiagLogSchema.parse({ reason: 'manual', commandId: 'cmd-audio' }),
    );
    expect(foreign.status).toBe('pending');
    expect(audio.status).toBe('pending');
  });

  it('ошибка ретеншна не роняет загрузку', async () => {
    const prisma = createPrismaMock({ devices: [device()] });
    prisma.diagLogUpload.deleteMany.mockRejectedValueOnce(new Error('db down'));
    const { svc } = makeService(prisma);
    const res = await svc.saveUpload(
      { deviceId: 'dev-1', childId: 'child-1' },
      UploadDiagLogSchema.parse({ reason: 'auto', trigger: 'crash', log: 'x' }),
    );
    expect(res.id).toBeDefined();
  });
});

describe('DiagService.applyRetention', () => {
  it('удаляет старше 14 дней (любого устройства) и всё сверх 30 последних у устройства', async () => {
    const now = new Date('2026-09-29T12:00:00Z');
    const uploads: Upload[] = [];
    // 35 свежих у dev-1 (минуты назад), 2 старых у dev-1, 1 старый у dev-2, 1 свежий у dev-2.
    for (let i = 0; i < 35; i++) {
      uploads.push({
        id: `fresh-${i}`,
        childDeviceId: 'dev-1',
        childId: 'child-1',
        createdAt: new Date(now.getTime() - i * 60_000),
      });
    }
    uploads.push(
      {
        id: 'old-1',
        childDeviceId: 'dev-1',
        childId: 'child-1',
        createdAt: new Date(now.getTime() - DIAG_RETENTION_MS - 1),
      },
      {
        id: 'old-2',
        childDeviceId: 'dev-1',
        childId: 'child-1',
        createdAt: new Date(now.getTime() - 20 * DAY),
      },
      {
        id: 'old-other',
        childDeviceId: 'dev-2',
        childId: 'child-2',
        createdAt: new Date(now.getTime() - 15 * DAY),
      },
      {
        id: 'fresh-other',
        childDeviceId: 'dev-2',
        childId: 'child-2',
        createdAt: new Date(now.getTime() - DAY),
      },
    );
    const prisma = createPrismaMock({ uploads });
    const { svc } = makeService(prisma);

    const removed = await svc.applyRetention('dev-1', now);

    expect(removed).toBe(3 + 5);
    const left = prisma._uploads.map((u) => u.id);
    expect(left.filter((id) => id.startsWith('fresh-') && id !== 'fresh-other')).toHaveLength(
      DIAG_MAX_UPLOADS_PER_DEVICE,
    );
    // Уцелели именно 30 самых новых.
    for (let i = 0; i < 30; i++) expect(left).toContain(`fresh-${i}`);
    for (let i = 30; i < 35; i++) expect(left).not.toContain(`fresh-${i}`);
    expect(left).toContain('fresh-other');
    expect(left).not.toContain('old-1');
    expect(left).not.toContain('old-2');
    expect(left).not.toContain('old-other');
  });

  it('ровно на границе 14 дней запись остаётся', async () => {
    const now = new Date('2026-09-29T12:00:00Z');
    const prisma = createPrismaMock({
      uploads: [
        {
          id: 'edge',
          childDeviceId: 'dev-1',
          childId: 'child-1',
          createdAt: new Date(now.getTime() - DIAG_RETENTION_MS),
        },
      ],
    });
    const { svc } = makeService(prisma);
    expect(await svc.applyRetention('dev-1', now)).toBe(0);
    expect(prisma._uploads).toHaveLength(1);
  });
});

describe('DiagService — настройки', () => {
  it('при подключении телефона уходит DIAG_CONFIG с подставленными умолчаниями', async () => {
    const prisma = createPrismaMock({
      devices: [device({ diagConfig: { debug: ['audio', 'bogus'], logcat: true } })],
    });
    const { svc, realtime, connected } = makeService(prisma, { rt: true });
    svc.onModuleInit();
    expect(connected).toHaveLength(1);

    await svc.pushConfigOnConnect('dev-1');
    expect(realtime.sendWithAck).toHaveBeenCalledWith('dev-1', {
      type: 'DIAG_CONFIG',
      config: JSON.stringify({ ...DEFAULT_DIAG_CONFIG, debug: ['audio'], logcat: true }),
    });
  });

  it('отозванному устройству настройки не шлются', async () => {
    const prisma = createPrismaMock({ devices: [device({ revokedAt: new Date() })] });
    const { svc, realtime } = makeService(prisma, { rt: true });
    expect(await svc.pushConfigOnConnect('dev-1')).toBe(false);
    expect(realtime.sendWithAck).not.toHaveBeenCalled();
  });

  it('PATCH сохраняет нормализованный конфиг, delivered = ack мгновенного канала', async () => {
    const dev = device();
    const prisma = createPrismaMock({ devices: [dev] });
    const { svc, realtime } = makeService(prisma, { rt: true });
    const dto = DiagConfigSchema.parse({
      send: ['push', 'audio', 'audio'],
      debug: ['audio'],
      debugUntil: '2026-09-30T12:00:00+03:00',
      logcat: true,
      snapshot: false,
      autoUpload: false,
    });
    const res = await svc.updateConfig('child-1', dto);
    const expected = {
      send: ['audio', 'push'],
      debug: ['audio'],
      debugUntil: '2026-09-30T09:00:00.000Z',
      logcat: true,
      snapshot: false,
      autoUpload: false,
    };
    expect(res).toEqual({ config: expected, delivered: true });
    expect(dev.diagConfig).toEqual(expected);
    expect(realtime.sendWithAck).toHaveBeenCalledWith('dev-1', {
      type: 'DIAG_CONFIG',
      config: JSON.stringify(expected),
    });
  });

  it('GET /child/diag/config без сохранённых настроек → умолчания', async () => {
    const prisma = createPrismaMock({ devices: [device()] });
    const { svc } = makeService(prisma);
    expect(await svc.getConfigForDevice('dev-1')).toEqual(DEFAULT_DIAG_CONFIG);
  });
});

describe('DiagService.getChildDiag', () => {
  it('устройство, конфиг, живой запрос и список журналов без текстов', async () => {
    const pending: Cmd = {
      id: 'cmd-1',
      childDeviceId: 'dev-1',
      type: 'UPLOAD_DIAG',
      status: 'pending',
      createdAt: new Date('2026-09-29T11:00:00Z'),
      expiresAt: new Date(Date.now() + DAY),
    };
    const prisma = createPrismaMock({
      devices: [device()],
      commands: [pending],
      uploads: [
        {
          id: 'u-old',
          childDeviceId: 'dev-1',
          childId: 'child-1',
          createdAt: new Date('2026-09-28T10:00:00Z'),
          reason: 'auto',
          trigger: 'crash',
          appVersion: '0.60.0+1',
          sizeBytes: 10,
        },
        {
          id: 'u-new',
          childDeviceId: 'dev-1',
          childId: 'child-1',
          createdAt: new Date('2026-09-29T10:00:00Z'),
          reason: 'manual',
          trigger: null,
          appVersion: '0.60.0+1',
          sizeBytes: 20,
        },
      ],
    });
    const { svc } = makeService(prisma, { rt: true });
    const view = await svc.getChildDiag('child-1');
    expect(view.device).toEqual({
      id: 'dev-1',
      appVersion: '0.60.0+1',
      lastSeenAt: '2026-09-29T10:00:00.000Z',
      online: true,
    });
    expect(view.config).toEqual(DEFAULT_DIAG_CONFIG);
    expect(view.pendingRequest?.commandId).toBe('cmd-1');
    expect(view.uploads.map((u) => u.id)).toEqual(['u-new', 'u-old']);
    // В списке — только поля из select (мок возвращает всю строку, так что
    // проверяем, что сервис запросил без текстов).
    const select = prisma.diagLogUpload.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('log');
    expect(select).not.toHaveProperty('logcat');
    expect(select).not.toHaveProperty('snapshot');
  });

  it('ребёнок без устройства → device null, config по умолчанию', async () => {
    const prisma = createPrismaMock({});
    const { svc } = makeService(prisma);
    const view = await svc.getChildDiag('child-no-device');
    expect(view).toEqual({
      device: null,
      config: DEFAULT_DIAG_CONFIG,
      pendingRequest: null,
      uploads: [],
    });
  });

  it('нет ребёнка → 404', async () => {
    const prisma = createPrismaMock({});
    const { svc } = makeService(prisma);
    await expect(svc.getChildDiag('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DiagService — журнал по id', () => {
  it('удаление несуществующего → 404 upload_not_found', async () => {
    const prisma = createPrismaMock({});
    const { svc } = makeService(prisma);
    await expect(svc.deleteUpload('nope')).rejects.toMatchObject({
      response: { code: 'upload_not_found' },
    });
    await expect(svc.getUpload('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
