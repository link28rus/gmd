/* eslint-disable @typescript-eslint/no-explicit-any */
import { SosService } from './sos.service';
import type { ChildAuthContext } from '../child-device/child-device.service';
import type { SosDto } from './dto/sos.dto';

const ctx: ChildAuthContext = {
  deviceId: 'dev1',
  childId: 'child1',
  familyId: 'fam1',
  childName: 'Алёша',
};

const validDto: SosDto = {
  lat: 55.7558,
  lon: 37.6173,
  accuracy: 10,
  recordedAt: new Date().toISOString(),
};

function makePrisma(
  overrides: {
    createdEvent?: any;
    family?: any;
  } = {},
): any {
  const createdEvent = overrides.createdEvent ?? {
    id: 'sos-id-1',
    serverCreatedAt: new Date('2026-04-20T10:00:00.000Z'),
  };
  return {
    sosEvent: {
      create: jest.fn().mockResolvedValue(createdEvent),
    },
    family: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.family === undefined
          ? {
              memberships: [{ user: { email: 'parent@example.com' } }],
            }
          : overrides.family,
      ),
    },
  };
}

function makeMailer(sendImpl?: jest.Mock): any {
  return { send: sendImpl ?? jest.fn().mockResolvedValue(undefined) };
}

describe('SosService.create', () => {
  it('creates a SosEvent in the database with correct fields', async () => {
    const prisma = makePrisma();
    const svc = new SosService(prisma, makeMailer());
    await svc.create(ctx, validDto);
    expect(prisma.sosEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        childId: 'child1',
        childDeviceId: 'dev1',
        lat: 55.7558,
        lon: 37.6173,
        accuracy: 10,
      }),
    });
  });

  it('returns sosId and createdAt ISO string', async () => {
    const prisma = makePrisma();
    const svc = new SosService(prisma, makeMailer());
    const result = await svc.create(ctx, validDto);
    expect(result.sosId).toBe('sos-id-1');
    expect(result.createdAt).toBe('2026-04-20T10:00:00.000Z');
  });

  it('sends email to all parent members', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const prisma = makePrisma({
      family: {
        memberships: [
          { user: { email: 'parent1@example.com' } },
          { user: { email: 'parent2@example.com' } },
        ],
      },
    });
    const svc = new SosService(prisma, makeMailer(sendMock));
    await svc.create(ctx, validDto);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'parent1@example.com',
        subject: expect.stringContaining('SOS'),
      }),
    );
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'parent2@example.com' }));
  });

  it('still returns 200-style result when mailer throws', async () => {
    const sendMock = jest.fn().mockRejectedValue(new Error('SMTP down'));
    const prisma = makePrisma();
    const svc = new SosService(prisma, makeMailer(sendMock));
    // Should not throw
    const result = await svc.create(ctx, validDto);
    expect(result.sosId).toBe('sos-id-1');
  });

  it('still returns result when family lookup throws', async () => {
    const prisma = makePrisma();
    prisma.family.findFirst = jest.fn().mockRejectedValue(new Error('DB error'));
    const svc = new SosService(prisma, makeMailer());
    const result = await svc.create(ctx, validDto);
    expect(result.sosId).toBe('sos-id-1');
  });

  it('skips email when no family found', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const prisma = makePrisma({ family: null });
    const svc = new SosService(prisma, makeMailer(sendMock));
    await svc.create(ctx, validDto);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('skips members with null email', async () => {
    const sendMock = jest.fn().mockResolvedValue(undefined);
    const prisma = makePrisma({
      family: {
        memberships: [{ user: { email: null } }, { user: { email: 'real@example.com' } }],
      },
    });
    const svc = new SosService(prisma, makeMailer(sendMock));
    await svc.create(ctx, validDto);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'real@example.com' }));
  });
});
