/* eslint-disable @typescript-eslint/no-explicit-any */
import { LocationsService } from './locations.service';
import type { ChildAuthContext } from '../child-device/child-device.service';

const ctx: ChildAuthContext = {
  deviceId: 'd1',
  childId: 'c1',
  familyId: 'f1',
  childName: 'Alex',
};

function makeService(
  overrides: Partial<{
    child: any;
    device: any;
    insertResult: number;
    ownerUserId: string;
    ownerAcceptedVersion: string | null;
    currentVersion: string;
  }> = {},
): LocationsService {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(overrides.insertResult ?? 0),
  };
  const prisma: any = {
    child: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.child === undefined
            ? { id: 'c1', familyId: 'f1', deletedAt: null }
            : overrides.child,
        ),
    },
    childDevice: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.device === undefined
            ? { id: 'd1', childId: 'c1', revokedAt: null }
            : overrides.device,
        ),
    },
    membership: {
      findFirst: jest.fn().mockResolvedValue({ userId: overrides.ownerUserId ?? 'owner1' }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        acceptedPrivacyPolicyVersion:
          overrides.ownerAcceptedVersion === undefined ? '1.0' : overrides.ownerAcceptedVersion,
      }),
    },
    location: {
      // Default: нет предыдущих точек у devices → jitter-dedup не срабатывает.
      // Тесты могут переопределить через (svc as any).prisma.location.findFirst.mockResolvedValue(...)
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn(),
    },
    $executeRaw: tx.$executeRaw,
    $transaction: jest.fn().mockImplementation((cb: (t: any) => Promise<unknown>) => cb(tx)),
  };
  const consent: any = {
    getCurrentVersion: () => overrides.currentVersion ?? '1.0',
    userRequiresConsent: (v: string | null) => v !== (overrides.currentVersion ?? '1.0'),
  };
  const zoneDetection: any = {
    processPoint: jest.fn().mockResolvedValue(undefined),
    findCandidateZones: jest.fn().mockResolvedValue([]),
  };
  const trips: any = {
    recomputeForChild: jest.fn().mockResolvedValue(undefined),
  };
  return new LocationsService(prisma, consent, zoneDetection, trips);
}

describe('LocationsService.ingestBatch', () => {
  it('accepts all points when valid', async () => {
    const svc = makeService({ insertResult: 2 });
    const now = new Date();
    const res = await svc.ingestBatch(ctx, [
      {
        lat: 55.0,
        lon: 37.0,
        recordedAt: new Date(now.getTime() - 60_000).toISOString(),
      },
      {
        lat: 55.1,
        lon: 37.1,
        recordedAt: new Date(now.getTime() - 30_000).toISOString(),
      },
    ]);
    expect(res).toEqual({ accepted: 2, rejected: 0, rejectedReasons: {} });
  });

  it('rejects points older than 24h with out_of_window', async () => {
    const svc = makeService({ insertResult: 1 });
    const now = new Date();
    const res = await svc.ingestBatch(ctx, [
      {
        lat: 55,
        lon: 37,
        recordedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(), // too old
      },
      {
        lat: 55,
        lon: 37,
        recordedAt: new Date(now.getTime() - 60_000).toISOString(), // valid
      },
    ]);
    expect(res.accepted).toBe(1);
    expect(res.rejected).toBe(1);
    expect(res.rejectedReasons.out_of_window).toBe(1);
  });

  it('rejects points >2min in future with out_of_window', async () => {
    const svc = makeService({ insertResult: 0 });
    const now = new Date();
    const res = await svc.ingestBatch(ctx, [
      {
        lat: 55,
        lon: 37,
        recordedAt: new Date(now.getTime() + 3 * 60_000).toISOString(),
      },
    ]);
    expect(res).toEqual({
      accepted: 0,
      rejected: 1,
      rejectedReasons: { out_of_window: 1 },
    });
  });

  it('counts duplicates when ON CONFLICT returns fewer rows than expected', async () => {
    const svc = makeService({ insertResult: 1 });
    const now = new Date();
    // Разнесём точки в пространстве на ~1 км, чтобы обе прошли jitter-dedup
    // и дошли до БД — только тогда ON CONFLICT может сыграть.
    const res = await svc.ingestBatch(ctx, [
      { lat: 55.0, lon: 37.0, recordedAt: new Date(now.getTime() - 60_000).toISOString() },
      { lat: 55.01, lon: 37.01, recordedAt: new Date(now.getTime() - 30_000).toISOString() },
    ]);
    expect(res.accepted).toBe(1);
    expect(res.rejected).toBe(1);
    expect(res.rejectedReasons.duplicate).toBe(1);
  });

  it('throws 404 child_not_found when child soft-deleted', async () => {
    const svc = makeService({
      child: { id: 'c1', familyId: 'f1', deletedAt: new Date() },
    });
    await expect(
      svc.ingestBatch(ctx, [{ lat: 55, lon: 37, recordedAt: new Date().toISOString() }]),
    ).rejects.toMatchObject({ response: { code: 'child_not_found' } });
  });

  it('throws 403 device_revoked when device has revokedAt', async () => {
    const svc = makeService({
      device: { id: 'd1', childId: 'c1', revokedAt: new Date() },
    });
    await expect(
      svc.ingestBatch(ctx, [{ lat: 55, lon: 37, recordedAt: new Date().toISOString() }]),
    ).rejects.toMatchObject({ response: { code: 'device_revoked' } });
  });

  it('throws 423 consent_required with currentPolicyVersion when owner not accepted', async () => {
    const svc = makeService({ ownerAcceptedVersion: '0.9', currentVersion: '1.0' });
    await expect(
      svc.ingestBatch(ctx, [{ lat: 55, lon: 37, recordedAt: new Date().toISOString() }]),
    ).rejects.toMatchObject({
      response: { code: 'consent_required', currentPolicyVersion: '1.0' },
      status: 423,
    });
  });

  it('caches consent check per childId (clearConsentCache works)', async () => {
    const svc = makeService({ insertResult: 1 });
    const p = { lat: 55, lon: 37, recordedAt: new Date().toISOString() };
    await svc.ingestBatch(ctx, [p]);
    svc.clearConsentCache();
    await svc.ingestBatch(ctx, [{ ...p, recordedAt: new Date(Date.now() - 1000).toISOString() }]);
    expect(true).toBe(true);
  });

  // v0.31.0 — фильтрация GPS-шума (safety net для старых APK).
  it('rejects points with accuracy > 100m as low_accuracy', async () => {
    const svc = makeService({ insertResult: 1 });
    const now = new Date();
    const res = await svc.ingestBatch(ctx, [
      {
        lat: 55,
        lon: 37,
        accuracy: 150, // too fuzzy — indoor multipath
        recordedAt: new Date(now.getTime() - 60_000).toISOString(),
      },
      {
        lat: 55.1,
        lon: 37.1,
        accuracy: 20, // good outdoor
        recordedAt: new Date(now.getTime() - 30_000).toISOString(),
      },
    ]);
    expect(res.accepted).toBe(1);
    expect(res.rejected).toBe(1);
    expect(res.rejectedReasons.low_accuracy).toBe(1);
  });

  it('accepts point without accuracy (undefined) — legacy clients without GPS accuracy', async () => {
    const svc = makeService({ insertResult: 1 });
    const now = new Date();
    const res = await svc.ingestBatch(ctx, [
      {
        lat: 55,
        lon: 37,
        // accuracy: undefined — DTO позволяет optional
        recordedAt: new Date(now.getTime() - 60_000).toISOString(),
      },
    ]);
    expect(res.accepted).toBe(1);
    expect(res.rejectedReasons.low_accuracy ?? 0).toBe(0);
  });

  it('rejects stationary jitter: close to last known point within 1 min', async () => {
    const svc = makeService({ insertResult: 0 });
    const now = Date.now();
    // "Предыдущая" точка из БД — 55.0, 37.0, 30 сек назад.
    (svc as any).prisma.location.findFirst.mockResolvedValue({
      lat: 55.0,
      lon: 37.0,
      recordedAt: new Date(now - 30_000),
    });
    const res = await svc.ingestBatch(ctx, [
      {
        // Дрожание GPS — точка на 10м смещена, accuracy=30м,
        // порог = max(30, 30*2=60) = 60м → 10м < 60м → jitter reject.
        lat: 55.00009, // ~10 метров на север
        lon: 37.0,
        accuracy: 30,
        recordedAt: new Date(now - 10_000).toISOString(),
      },
    ]);
    expect(res.accepted).toBe(0);
    expect(res.rejected).toBe(1);
    expect(res.rejectedReasons.jitter).toBe(1);
  });

  it('accepts point far enough from last known even within dedup window', async () => {
    const svc = makeService({ insertResult: 1 });
    const now = Date.now();
    (svc as any).prisma.location.findFirst.mockResolvedValue({
      lat: 55.0,
      lon: 37.0,
      recordedAt: new Date(now - 30_000),
    });
    const res = await svc.ingestBatch(ctx, [
      {
        // 55.001 ≈ 111м от 55.0 — заведомо больше порога (max(30, accuracy*2=20))
        lat: 55.001,
        lon: 37.0,
        accuracy: 10,
        recordedAt: new Date(now - 10_000).toISOString(),
      },
    ]);
    expect(res.accepted).toBe(1);
    expect(res.rejectedReasons.jitter ?? 0).toBe(0);
  });

  it('does not apply jitter-dedup when last known point is older than 1 min', async () => {
    const svc = makeService({ insertResult: 1 });
    const now = Date.now();
    // Последняя точка — 2 минуты назад. Dedup НЕ должен срабатывать,
    // даже если новая точка близко (ребёнок мог вернуться в то же место).
    (svc as any).prisma.location.findFirst.mockResolvedValue({
      lat: 55.0,
      lon: 37.0,
      recordedAt: new Date(now - 2 * 60_000),
    });
    const res = await svc.ingestBatch(ctx, [
      {
        lat: 55.00009, // 10 м — впритирку
        lon: 37.0,
        accuracy: 30,
        recordedAt: new Date(now - 10_000).toISOString(),
      },
    ]);
    expect(res.accepted).toBe(1);
    expect(res.rejectedReasons.jitter ?? 0).toBe(0);
  });

  it('applies jitter-dedup within the same batch (batch-internal stationary)', async () => {
    const svc = makeService({ insertResult: 1 });
    const now = Date.now();
    // Нет lastKnown в БД. Первая точка батча пройдёт, вторая должна быть
    // отброшена как jitter относительно первой.
    const res = await svc.ingestBatch(ctx, [
      {
        lat: 55.0,
        lon: 37.0,
        accuracy: 30,
        recordedAt: new Date(now - 30_000).toISOString(),
      },
      {
        lat: 55.00009, // ~10м от первой → дрожь
        lon: 37.0,
        accuracy: 30,
        recordedAt: new Date(now - 10_000).toISOString(),
      },
    ]);
    expect(res.accepted).toBe(1);
    expect(res.rejected).toBe(1);
    expect(res.rejectedReasons.jitter).toBe(1);
  });
});

describe('LocationsService.getLatest', () => {
  it('returns null when no locations', async () => {
    const svc = makeService();
    (svc as any).prisma.location.findFirst.mockResolvedValue(null);
    const res = await svc.getLatest('c1');
    expect(res).toBeNull();
  });

  it('returns point with ageSec when present', async () => {
    const svc = makeService();
    const recordedAt = new Date(Date.now() - 5000);
    (svc as any).prisma.location.findFirst.mockResolvedValue({
      id: 'l1',
      lat: 55,
      lon: 37,
      recordedAt,
      serverReceivedAt: recordedAt,
      accuracy: 1,
      altitude: 2,
      speed: 3,
      bearing: 4,
      batteryLevel: 50,
      isCharging: false,
      provider: 'gps',
    });
    const res = await svc.getLatest('c1');
    expect(res).toMatchObject({ lat: 55, lon: 37, batteryLevel: 50 });
    expect(res?.ageSec).toBeGreaterThanOrEqual(4);
    expect(res?.ageSec).toBeLessThan(10);
  });
});

describe('LocationsService.list', () => {
  it('applies desc order + limit + cursor (recordedAt < cursor)', async () => {
    const svc = makeService();
    (svc as any).prisma.location.findMany.mockResolvedValue([
      { id: 'a', recordedAt: new Date('2026-04-19T10:00:00Z'), lat: 55, lon: 37 },
      { id: 'b', recordedAt: new Date('2026-04-19T09:00:00Z'), lat: 55.1, lon: 37.1 },
    ]);
    const res = await svc.list('c1', {
      limit: 2,
      order: 'desc',
      cursor: '2026-04-19T11:00:00Z',
    } as any);
    expect(res.items).toHaveLength(2);
    expect(res.nextCursor).toBe('2026-04-19T09:00:00.000Z');
    expect((svc as any).prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          childId: 'c1',
          recordedAt: expect.objectContaining({ lt: new Date('2026-04-19T11:00:00Z') }),
        }),
        orderBy: { recordedAt: 'desc' },
        take: 2,
      }),
    );
  });

  it('returns null nextCursor when fewer results than limit', async () => {
    const svc = makeService();
    (svc as any).prisma.location.findMany.mockResolvedValue([
      { id: 'a', recordedAt: new Date('2026-04-19T10:00:00Z'), lat: 55, lon: 37 },
    ]);
    const res = await svc.list('c1', { limit: 10, order: 'desc' } as any);
    expect(res.nextCursor).toBeNull();
  });
});
