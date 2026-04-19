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
});
