import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { FcmService } from '../fcm/fcm.service';
import { ParentDevicesService } from '../parent-devices/parent-devices.service';
import {
  ZoneDetectionService,
  buffer,
  classifyPoint,
  initialInside,
} from './zone-detection.service';

describe('classifyPoint (v0.64.0, учёт погрешности)', () => {
  // R = 150 → B = max(30, 22.5) = 30
  it('буфер — max(30, 0.15R)', () => {
    expect(buffer(150)).toBe(30);
    expect(buffer(1000)).toBe(150);
  });

  it('точная точка внутри радиуса — внутри', () => {
    expect(classifyPoint(149, 0, 150)).toBe('inside');
    expect(classifyPoint(150, null, 150)).toBe('inside');
  });

  it('внутри — только если d + acc/2 ≤ R', () => {
    expect(classifyPoint(120, 60, 150)).toBe('inside');
    expect(classifyPoint(121, 60, 150)).toBeNull();
  });

  it('снаружи — только если d − acc > R + B', () => {
    expect(classifyPoint(241, 60, 150)).toBe('outside');
    expect(classifyPoint(240, 60, 150)).toBeNull();
    expect(classifyPoint(181, 0, 150)).toBe('outside');
  });

  it('грубая ночная точка из квартиры у границы — неясно, а не «ушёл»', () => {
    expect(classifyPoint(200, 90, 150)).toBeNull();
  });

  it('initialInside: однозначный вердикт по формуле, неясно — по d ≤ R', () => {
    expect(initialInside(100, 20, 150)).toBe(true);
    expect(initialInside(300, 20, 150)).toBe(false);
    expect(initialInside(140, 80, 150)).toBe(true); // неясно, d ≤ R
    expect(initialInside(160, 80, 150)).toBe(false); // неясно, d > R
  });
});

function makeTx() {
  return {
    $queryRaw: jest.fn(),
    zoneState: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    zoneEvent: { create: jest.fn() },
  };
}

type Tx = ReturnType<typeof makeTx>;

async function makeService(opts: {
  sendHybrid?: jest.Mock;
  devices?: Array<{ userId?: string; fcmToken: string; rustorePushToken: string | null }>;
  zone?: {
    timezone?: string;
    scheduleDaysMask?: number;
    scheduleStartMin?: number;
    scheduleEndMin?: number;
    arrivalDeadlineMin?: number;
  };
  prefs?: Array<{ userId: string; onEntry: boolean; onExit: boolean; onMissedArrival: boolean }>;
}): Promise<ZoneDetectionService> {
  const module = await Test.createTestingModule({
    providers: [
      ZoneDetectionService,
      {
        provide: PrismaService,
        useValue: {
          child: { findUnique: jest.fn().mockResolvedValue({ name: 'Тимофей' }) },
          zone: {
            findUnique: jest.fn().mockResolvedValue({
              name: 'Школа',
              timezone: opts.zone?.timezone ?? null,
              scheduleDaysMask: opts.zone?.scheduleDaysMask ?? null,
              scheduleStartMin: opts.zone?.scheduleStartMin ?? null,
              scheduleEndMin: opts.zone?.scheduleEndMin ?? null,
              arrivalDeadlineMin: opts.zone?.arrivalDeadlineMin ?? null,
            }),
          },
          zoneNotificationPref: { findMany: jest.fn().mockResolvedValue(opts.prefs ?? []) },
        },
      },
      {
        provide: FcmService,
        useValue: { sendHybridToToken: opts.sendHybrid ?? jest.fn().mockResolvedValue(true) },
      },
      {
        provide: ParentDevicesService,
        useValue: {
          findActiveByFamilyId: jest
            .fn()
            .mockResolvedValue((opts.devices ?? []).map((d) => ({ userId: 'u1', ...d }))),
          clearTokenByExpired: jest.fn(),
          clearRustoreByExpired: jest.fn(),
        },
      },
    ],
  }).compile();
  return module.get(ZoneDetectionService);
}

const T0 = new Date('2026-09-29T10:00:00Z');

function point(recordedAt: Date, accuracy: number | null = 10) {
  return {
    familyId: 'f1',
    childId: 'c1',
    deviceId: 'd1',
    lat: 48.48,
    lon: 135.08,
    accuracy,
    recordedAt,
  };
}

function state(over: Record<string, unknown> = {}) {
  return {
    zoneId: 'z1',
    childId: 'c1',
    isInside: false,
    pendingTransition: false,
    pendingSince: null,
    lastConfirmedChange: null,
    ...over,
  };
}

describe('ZoneDetectionService.processPoint', () => {
  let svc: ZoneDetectionService;
  let tx: Tx;

  beforeEach(async () => {
    svc = await makeService({});
    tx = makeTx();
  });

  it('нет применимых зон — ничего не делает', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    await expect(svc.processPoint(tx as never, point(T0))).resolves.toEqual([]);
    expect(tx.zoneState.findMany).not.toHaveBeenCalled();
  });

  it('первая точка внутри при isInside=false — ставит ожидание, события нет', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 150, distance_m: 50 }]);
    tx.zoneState.findMany.mockResolvedValue([state()]);
    const notices = await svc.processPoint(tx as never, point(T0));
    expect(notices).toEqual([]);
    expect(tx.zoneState.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pendingTransition: true, pendingSince: T0 } }),
    );
    expect(tx.zoneEvent.create).not.toHaveBeenCalled();
  });

  it('через 60 с подтверждения — entry без длительности, возвращает событие', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 150, distance_m: 50 }]);
    tx.zoneState.findMany.mockResolvedValue([
      state({ pendingTransition: true, pendingSince: new Date(T0.getTime() - 61_000) }),
    ]);
    const notices = await svc.processPoint(tx as never, point(T0));
    expect(notices).toEqual([
      { familyId: 'f1', childId: 'c1', zoneId: 'z1', eventType: 'entry', recordedAt: T0 },
    ]);
    expect(tx.zoneEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'entry', durationSec: null }),
    });
    expect(tx.zoneState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isInside: true, lastConfirmedChange: T0 }),
      }),
    );
  });

  it('меньше 60 с — ждёт, якорь pendingSince не сдвигает', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 150, distance_m: 50 }]);
    tx.zoneState.findMany.mockResolvedValue([
      state({ pendingTransition: true, pendingSince: new Date(T0.getTime() - 30_000) }),
    ]);
    await svc.processPoint(tx as never, point(T0));
    expect(tx.zoneState.update).not.toHaveBeenCalled();
    expect(tx.zoneEvent.create).not.toHaveBeenCalled();
  });

  it('exit считает длительность от подтверждённого входа', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 150, distance_m: 400 }]);
    tx.zoneState.findMany.mockResolvedValue([
      state({
        isInside: true,
        pendingTransition: true,
        pendingSince: new Date(T0.getTime() - 70_000),
        lastConfirmedChange: new Date(T0.getTime() - 3_600_000),
      }),
    ]);
    const notices = await svc.processPoint(tx as never, point(T0));
    expect(notices[0].eventType).toBe('exit');
    expect(tx.zoneEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'exit', durationSec: 3600 }),
    });
  });

  it('неясная точка — гистерезис: ожидание выхода НЕ сбрасывается', async () => {
    // d=200, acc=90, R=150: ни внутри, ни снаружи.
    tx.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 150, distance_m: 200 }]);
    tx.zoneState.findMany.mockResolvedValue([
      state({
        isInside: true,
        pendingTransition: true,
        pendingSince: new Date(T0.getTime() - 120_000),
      }),
    ]);
    const notices = await svc.processPoint(tx as never, point(T0, 90));
    expect(notices).toEqual([]);
    expect(tx.zoneState.update).not.toHaveBeenCalled();
    expect(tx.zoneEvent.create).not.toHaveBeenCalled();
  });

  it('однозначная точка, совпавшая с состоянием, сбрасывает ожидание', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 150, distance_m: 20 }]);
    tx.zoneState.findMany.mockResolvedValue([
      state({ isInside: true, pendingTransition: true, pendingSince: T0 }),
    ]);
    await svc.processPoint(tx as never, point(new Date(T0.getTime() + 10_000)));
    expect(tx.zoneState.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pendingTransition: false, pendingSince: null } }),
    );
  });

  it('нет состояния (зона «для всех», новый ребёнок) — молча задаёт состояние', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 150, distance_m: 30 }]);
    tx.zoneState.findMany.mockResolvedValue([]);
    const notices = await svc.processPoint(tx as never, point(T0));
    expect(notices).toEqual([]);
    expect(tx.zoneState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { zoneId: 'z1', childId: 'c1', isInside: true } }),
    );
    expect(tx.zoneEvent.create).not.toHaveBeenCalled();
  });

  it('processPoint сам push не шлёт — только notifyParents после commit', async () => {
    const sendHybrid = jest.fn().mockResolvedValue(true);
    svc = await makeService({
      sendHybrid,
      devices: [{ fcmToken: 'fcm1', rustorePushToken: null }],
    });
    tx.$queryRaw.mockResolvedValue([{ id: 'z1', radius: 150, distance_m: 50 }]);
    tx.zoneState.findMany.mockResolvedValue([
      state({ pendingTransition: true, pendingSince: new Date(T0.getTime() - 61_000) }),
    ]);
    const notices = await svc.processPoint(tx as never, point(T0));
    await new Promise((r) => setImmediate(r));
    expect(sendHybrid).not.toHaveBeenCalled();
    svc.notifyParents(notices);
    await new Promise((r) => setImmediate(r));
    expect(sendHybrid).toHaveBeenCalledTimes(1);
  });
});

describe('ZoneDetectionService push: delayed flag', () => {
  let sendHybrid: jest.Mock;
  let svc: ZoneDetectionService;

  beforeEach(async () => {
    sendHybrid = jest.fn().mockResolvedValue(true);
    svc = await makeService({
      sendHybrid,
      devices: [{ fcmToken: 'fcm1', rustorePushToken: null }],
    });
  });

  async function entryAt(recordedAt: Date): Promise<Record<string, string>> {
    svc.notifyParents([
      { familyId: 'f1', childId: 'c1', zoneId: 'z1', eventType: 'entry', recordedAt },
    ]);
    await new Promise((r) => setImmediate(r));
    expect(sendHybrid).toHaveBeenCalledTimes(1);
    return sendHybrid.mock.calls[0][0].data as Record<string, string>;
  }

  it('marks the push as delayed when the point is older than 3 minutes', async () => {
    const data = await entryAt(new Date(Date.now() - 60 * 60_000));
    expect(data.type).toBe('GEOFENCE_ENTER');
    expect(data.zoneName).toBe('Школа');
    expect(data.delayed).toBe('1');
  });

  it('live event has no delayed flag', async () => {
    const data = await entryAt(new Date(Date.now() - 30_000));
    expect(data.delayed).toBeUndefined();
  });
});

describe('ZoneDetectionService push: личные настройки и расписание (v0.65.0)', () => {
  const recent = (): Date => new Date(Date.now() - 30_000);

  it('родитель с выключенным «приход» не получает push, другой получает', async () => {
    const sendHybrid = jest.fn().mockResolvedValue(true);
    const svc = await makeService({
      sendHybrid,
      devices: [
        { userId: 'mom', fcmToken: 'fcm-mom', rustorePushToken: null },
        { userId: 'dad', fcmToken: 'fcm-dad', rustorePushToken: null },
      ],
      prefs: [{ userId: 'dad', onEntry: false, onExit: true, onMissedArrival: true }],
    });
    svc.notifyParents([
      { familyId: 'f1', childId: 'c1', zoneId: 'z1', eventType: 'entry', recordedAt: recent() },
    ]);
    await new Promise((r) => setImmediate(r));
    expect(sendHybrid).toHaveBeenCalledTimes(1);
    expect(sendHybrid.mock.calls[0][0].tokens.fcmToken).toBe('fcm-mom');
  });

  it('вне окна расписания push о приходе не уходит', async () => {
    const sendHybrid = jest.fn().mockResolvedValue(true);
    // Окно 03:00–04:00 по Владивостоку каждый день — «сейчас» в него почти не попадает;
    // событие — 12:00 по Владивостоку.
    const svc = await makeService({
      sendHybrid,
      devices: [{ fcmToken: 'fcm1', rustorePushToken: null }],
      zone: {
        timezone: 'Asia/Vladivostok',
        scheduleDaysMask: 127,
        scheduleStartMin: 180,
        scheduleEndMin: 240,
      },
    });
    svc.notifyParents([
      {
        familyId: 'f1',
        childId: 'c1',
        zoneId: 'z1',
        eventType: 'exit',
        recordedAt: new Date('2026-09-30T02:00:00Z'),
      },
    ]);
    await new Promise((r) => setImmediate(r));
    expect(sendHybrid).not.toHaveBeenCalled();
  });

  it('«не пришёл» уходит с видимым уведомлением и сроком, расписание его не гасит', async () => {
    const sendHybrid = jest.fn().mockResolvedValue(true);
    const svc = await makeService({
      sendHybrid,
      devices: [{ fcmToken: 'fcm1', rustorePushToken: null }],
      zone: {
        timezone: 'Asia/Vladivostok',
        scheduleDaysMask: 127,
        scheduleStartMin: 180,
        scheduleEndMin: 240,
        arrivalDeadlineMin: 510,
      },
    });
    svc.notifyParents([
      {
        familyId: 'f1',
        childId: 'c1',
        zoneId: 'z1',
        eventType: 'missed_arrival',
        recordedAt: new Date('2026-09-30T02:00:00Z'),
      },
    ]);
    await new Promise((r) => setImmediate(r));
    expect(sendHybrid).toHaveBeenCalledTimes(1);
    const args = sendHybrid.mock.calls[0][0];
    expect(args.data.type).toBe('GEOFENCE_MISSED');
    expect(args.data.deadline).toBe('08:30');
    expect(args.notification.body).toContain('к 08:30');
    expect(args.notification.channelId).toBe('periscop_parent_events');
  });

  it('приход/уход — без видимого уведомления (рисует сам APK)', async () => {
    const sendHybrid = jest.fn().mockResolvedValue(true);
    const svc = await makeService({
      sendHybrid,
      devices: [{ fcmToken: 'fcm1', rustorePushToken: null }],
    });
    svc.notifyParents([
      { familyId: 'f1', childId: 'c1', zoneId: 'z1', eventType: 'entry', recordedAt: recent() },
    ]);
    await new Promise((r) => setImmediate(r));
    expect(sendHybrid.mock.calls[0][0].notification).toBeUndefined();
  });
});
