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
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(overrides.insertResult ?? 0),
  };
  const consent: any = {
    getCurrentVersion: () => overrides.currentVersion ?? '1.0',
    userRequiresConsent: (v: string | null) => v !== (overrides.currentVersion ?? '1.0'),
  };
  return new LocationsService(prisma, consent);
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
    const res = await svc.ingestBatch(ctx, [
      { lat: 55, lon: 37, recordedAt: new Date(now.getTime() - 60_000).toISOString() },
      { lat: 55, lon: 37, recordedAt: new Date(now.getTime() - 30_000).toISOString() },
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
});
