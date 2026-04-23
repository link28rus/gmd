import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AudioService } from './audio.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { DeviceCommandsService } from '../device-commands/device-commands.service';
import { AudioEvents } from './audio.events';

describe('AudioService.generateTurnCreds', () => {
  let svc: AudioService;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(async () => {
    process.env.TURN_SHARED_SECRET = 'test-secret-32chars-long-enough!';
    process.env.TURN_PUBLIC_HOST = 'turn.example.com';
    process.env.TURN_PUBLIC_PORT = '3478';

    const moduleRef = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: PrismaService, useValue: {} },
        { provide: AppSettingsService, useValue: {} },
        { provide: DeviceCommandsService, useValue: {} },
        { provide: AudioEvents, useValue: { emitState: jest.fn(), subscribe: jest.fn() } },
      ],
    }).compile();
    svc = moduleRef.get(AudioService);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('generates RFC 5766-style time-limited creds', () => {
    const sessionId = 'sess_abc123';
    const ttlSec = 600;

    const creds = svc.generateTurnCreds(sessionId, ttlSec);

    expect(creds.url).toBe('turn:turn.example.com:3478');
    expect(creds.username).toMatch(/^\d+:sess_abc123$/);
    const ts = Number(creds.username.split(':')[0]);
    const now = Math.floor(Date.now() / 1000);
    expect(ts).toBeGreaterThan(now);
    expect(ts).toBeLessThanOrEqual(now + ttlSec + 1);
    expect(creds.password).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(creds.ttl).toBe(ttlSec);
  });

  it('produces different passwords for different session ids', () => {
    const a = svc.generateTurnCreds('sess_a', 600);
    const b = svc.generateTurnCreds('sess_b', 600);
    expect(a.password).not.toBe(b.password);
  });

  it('throws when TURN_SHARED_SECRET is missing', () => {
    delete process.env.TURN_SHARED_SECRET;
    expect(() => svc.generateTurnCreds('s1', 600)).toThrow(/TURN_SHARED_SECRET/);
    process.env.TURN_SHARED_SECRET = 'test-secret-32chars-long-enough!';
  });

  it('throws when TURN_PUBLIC_HOST is missing', () => {
    delete process.env.TURN_PUBLIC_HOST;
    expect(() => svc.generateTurnCreds('s1', 600)).toThrow(/TURN_PUBLIC_HOST/);
    process.env.TURN_PUBLIC_HOST = 'turn.example.com';
  });

  it('uses default port 3478 when TURN_PUBLIC_PORT missing', () => {
    delete process.env.TURN_PUBLIC_PORT;
    const creds = svc.generateTurnCreds('s1', 600);
    expect(creds.url).toBe('turn:turn.example.com:3478');
    process.env.TURN_PUBLIC_PORT = '3478';
  });
});

describe('AudioService.startSession', () => {
  let svc: AudioService;
  let prisma: {
    child: { findFirst: jest.Mock };
    childDevice: { findFirst: jest.Mock };
    audioSession: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    audioAuditLog: { create: jest.Mock };
  };
  let settings: { getNumber: jest.Mock; getBool: jest.Mock };
  let commands: { enqueueAudioStart: jest.Mock; enqueueAudioStop: jest.Mock };
  let events: { emitState: jest.Mock; subscribe: jest.Mock };
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.TURN_SHARED_SECRET = 'test-secret';
    process.env.TURN_PUBLIC_HOST = 'turn.example.com';
    process.env.TURN_PUBLIC_PORT = '3478';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    jest.useFakeTimers();

    prisma = {
      child: { findFirst: jest.fn() },
      childDevice: { findFirst: jest.fn() },
      audioSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'sess_new', ...data, startedAt: new Date() }),
          ),
        update: jest.fn().mockResolvedValue({}),
      },
      audioAuditLog: { create: jest.fn() },
    };
    settings = {
      getNumber: jest.fn().mockImplementation((k: string, fb: number) => {
        const map: Record<string, number> = {
          'audio.default_duration_sec': 300,
          'audio.max_duration_sec': 1800,
          'audio.min_duration_sec': 30,
          'audio.child_ready_timeout_sec': 45,
        };
        return Promise.resolve(map[k] ?? fb);
      }),
      getBool: jest.fn().mockResolvedValue(true),
    };
    commands = { enqueueAudioStart: jest.fn(), enqueueAudioStop: jest.fn() };
    events = { emitState: jest.fn(), subscribe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppSettingsService, useValue: settings },
        { provide: DeviceCommandsService, useValue: commands },
        { provide: AudioEvents, useValue: events },
      ],
    }).compile();
    svc = moduleRef.get(AudioService);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('throws NotFoundException if child not in family', async () => {
    prisma.child.findFirst.mockResolvedValue(null);
    await expect(
      svc.startSession({
        familyId: 'fam_1',
        userId: 'u_1',
        childId: 'c_x',
        durationSec: 300,
        hiddenMode: true,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException if no active device', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue(null);
    await expect(
      svc.startSession({
        familyId: 'fam_1',
        userId: 'u_1',
        childId: 'c_1',
        durationSec: 300,
        hiddenMode: true,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException if active session exists', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });
    prisma.audioSession.findFirst.mockResolvedValue({ id: 'sess_active', state: 'ACTIVE' });
    await expect(
      svc.startSession({
        familyId: 'fam_1',
        userId: 'u_1',
        childId: 'c_1',
        durationSec: 300,
        hiddenMode: true,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('clamps durationSec into [min, max]', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });

    await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      durationSec: 9999,
      hiddenMode: true,
    });
    expect(prisma.audioSession.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSec: 1800 }),
      }),
    );

    await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      durationSec: 5,
      hiddenMode: true,
    });
    expect(prisma.audioSession.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ durationSec: 30 }),
      }),
    );
  });

  it('creates session, enqueues START_AUDIO, writes audit, returns turnCreds', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });

    const result = await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      durationSec: 300,
      hiddenMode: true,
      ip: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(result.state).toBe('PENDING');
    expect(result.turnCreds.url).toBe('turn:turn.example.com:3478');
    expect(result.turnCreds.password).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(commands.enqueueAudioStart).toHaveBeenCalledWith(
      'd_1',
      expect.any(String),
      expect.objectContaining({ url: 'turn:turn.example.com:3478' }),
      300,
      'u_1',
      expect.any(Number),
    );
    expect(prisma.audioAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event: 'REQUESTED', actorUserId: 'u_1' }),
      }),
    );
    expect(events.emitState).toHaveBeenCalledWith(expect.any(String), 'PENDING');
  });

  it('hidden mode disabled when settings forbid it', async () => {
    settings.getBool.mockResolvedValue(false);
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });

    await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      durationSec: 300,
      hiddenMode: true,
    });

    expect(prisma.audioSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ hiddenMode: false }),
      }),
    );
  });
});

interface ChildSidePrisma {
  audioSession: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  audioAuditLog: { create: jest.Mock };
  audioIceCandidate: { create: jest.Mock };
}

interface ChildSideEvents {
  emitState: jest.Mock;
  subscribe: jest.Mock;
}

describe('AudioService child-side', () => {
  let svc: AudioService;
  let prisma: ChildSidePrisma;
  let events: ChildSideEvents;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.TURN_SHARED_SECRET = 'test-secret';
    process.env.TURN_PUBLIC_HOST = 'turn.example.com';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    prisma = {
      audioSession: {
        findUnique: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
      },
      audioAuditLog: { create: jest.fn() },
      audioIceCandidate: { create: jest.fn() },
    };
    events = { emitState: jest.fn(), subscribe: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppSettingsService, useValue: { getNumber: jest.fn(), getBool: jest.fn() } },
        { provide: DeviceCommandsService, useValue: {} },
        { provide: AudioEvents, useValue: events },
      ],
    }).compile();
    svc = moduleRef.get(AudioService);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('childReady', () => {
    it('PENDING → READY, stores SDP, emits READY event', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        childDeviceId: 'd1',
        state: 'PENDING',
      });
      await svc.childReady({ sessionId: 's1', deviceId: 'd1', sdpOffer: 'v=0\r\no=- ...' });
      expect(prisma.audioSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { state: 'READY', readyAt: expect.any(Date), sdpOffer: 'v=0\r\no=- ...' },
      });
      expect(events.emitState).toHaveBeenCalledWith('s1', 'READY', { sdp: 'v=0\r\no=- ...' });
    });

    it('rejects (Forbidden) if deviceId mismatch', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        childDeviceId: 'd_other',
        state: 'PENDING',
      });
      await expect(
        svc.childReady({ sessionId: 's1', deviceId: 'd1', sdpOffer: '...' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects (Conflict) if state != PENDING', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        childDeviceId: 'd1',
        state: 'ACTIVE',
      });
      await expect(
        svc.childReady({ sessionId: 's1', deviceId: 'd1', sdpOffer: '...' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects if session not found', async () => {
      prisma.audioSession.findUnique.mockResolvedValue(null);
      await expect(
        svc.childReady({ sessionId: 's_missing', deviceId: 'd1', sdpOffer: '...' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('childIce', () => {
    it('persists candidate (side=child), emits ICE event', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        childDeviceId: 'd1',
        state: 'READY',
      });
      await svc.childIce({ sessionId: 's1', deviceId: 'd1', candidate: 'candidate:1 1 UDP ...' });
      expect(prisma.audioIceCandidate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: 's1',
          side: 'child',
          candidate: 'candidate:1 1 UDP ...',
        }),
      });
      expect(events.emitState).toHaveBeenCalledWith('s1', 'ICE', {
        side: 'child',
        candidate: 'candidate:1 1 UDP ...',
      });
    });

    it('rejects if state not in [PENDING, READY, ACTIVE]', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        childDeviceId: 'd1',
        state: 'ENDED',
      });
      await expect(
        svc.childIce({ sessionId: 's1', deviceId: 'd1', candidate: '...' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects if deviceId mismatch', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        childDeviceId: 'd_other',
        state: 'READY',
      });
      await expect(
        svc.childIce({ sessionId: 's1', deviceId: 'd1', candidate: '...' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('childError', () => {
    it('marks FAILED with reason, audits, emits FAILED', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        childDeviceId: 'd1',
        state: 'PENDING',
      });
      await svc.childError({
        sessionId: 's1',
        deviceId: 'd1',
        code: 'PERMISSION_DENIED',
        message: 'mic denied',
      });
      expect(prisma.audioSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: 'FAILED',
            failureReason: 'PERMISSION_DENIED',
            endedAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.audioAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            event: 'FAILED',
            metadata: { code: 'PERMISSION_DENIED', message: 'mic denied' },
          }),
        }),
      );
      expect(events.emitState).toHaveBeenCalledWith('s1', 'FAILED', {
        reason: 'PERMISSION_DENIED',
      });
    });

    it('idempotent: no-op if already ENDED/FAILED/EXPIRED', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        childDeviceId: 'd1',
        state: 'ENDED',
      });
      await svc.childError({ sessionId: 's1', deviceId: 'd1', code: 'UNKNOWN' });
      expect(prisma.audioSession.update).not.toHaveBeenCalled();
      expect(prisma.audioAuditLog.create).not.toHaveBeenCalled();
      expect(events.emitState).not.toHaveBeenCalled();
    });

    it('rejects if deviceId mismatch', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        childDeviceId: 'd_other',
        state: 'PENDING',
      });
      await expect(
        svc.childError({ sessionId: 's1', deviceId: 'd1', code: 'UNKNOWN' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

interface ParentSidePrisma {
  audioSession: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  audioAuditLog: { create: jest.Mock };
  audioIceCandidate: { create: jest.Mock };
}

interface ParentSideCommands {
  enqueueAudioStart: jest.Mock;
  enqueueAudioStop: jest.Mock;
}

describe('AudioService parent-side', () => {
  let svc: AudioService;
  let prisma: ParentSidePrisma;
  let events: ChildSideEvents;
  let commands: ParentSideCommands;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.TURN_SHARED_SECRET = 'test-secret';
    process.env.TURN_PUBLIC_HOST = 'turn.example.com';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    prisma = {
      audioSession: {
        findUnique: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, ...data })),
      },
      audioAuditLog: { create: jest.fn() },
      audioIceCandidate: { create: jest.fn() },
    };
    events = { emitState: jest.fn(), subscribe: jest.fn() };
    commands = { enqueueAudioStart: jest.fn(), enqueueAudioStop: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AudioService,
        { provide: PrismaService, useValue: prisma },
        { provide: AppSettingsService, useValue: { getNumber: jest.fn(), getBool: jest.fn() } },
        { provide: DeviceCommandsService, useValue: commands },
        { provide: AudioEvents, useValue: events },
      ],
    }).compile();
    svc = moduleRef.get(AudioService);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('parentAnswer', () => {
    it('READY → ACTIVE, stores answer, audits STARTED, emits ACTIVE, schedules autostop', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        requestedById: 'u1',
        childId: 'c1',
        state: 'READY',
        durationSec: 60,
      });

      await svc.parentAnswer({
        sessionId: 's1',
        userId: 'u1',
        familyId: 'fam1',
        sdpAnswer: 'v=0\r\n...',
      });

      expect(prisma.audioSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { state: 'ACTIVE', activeAt: expect.any(Date), sdpAnswer: 'v=0\r\n...' },
      });
      expect(prisma.audioAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event: 'STARTED', actorUserId: 'u1' }),
        }),
      );
      expect(events.emitState).toHaveBeenCalledWith('s1', 'ACTIVE');
    });

    it('rejects (Conflict) if state != READY', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        requestedById: 'u1',
        state: 'PENDING',
        durationSec: 60,
      });
      await expect(
        svc.parentAnswer({ sessionId: 's1', userId: 'u1', familyId: 'fam1', sdpAnswer: '...' }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects (Forbidden) if userId != requestedById', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        requestedById: 'u_other',
        state: 'READY',
        durationSec: 60,
      });
      await expect(
        svc.parentAnswer({ sessionId: 's1', userId: 'u1', familyId: 'fam1', sdpAnswer: '...' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('parentIce', () => {
    it('persists candidate (side=parent), emits ICE event', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        requestedById: 'u1',
        state: 'READY',
      });
      await svc.parentIce({ sessionId: 's1', userId: 'u1', candidate: 'candidate:1 1 UDP ...' });
      expect(prisma.audioIceCandidate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sessionId: 's1',
          side: 'parent',
          candidate: 'candidate:1 1 UDP ...',
        }),
      });
      expect(events.emitState).toHaveBeenCalledWith('s1', 'ICE', {
        side: 'parent',
        candidate: 'candidate:1 1 UDP ...',
      });
    });

    it('rejects (Forbidden) if userId mismatch', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        requestedById: 'u_other',
        state: 'READY',
      });
      await expect(
        svc.parentIce({ sessionId: 's1', userId: 'u1', candidate: '...' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects (Conflict) if state not in [READY, ACTIVE]', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        requestedById: 'u1',
        state: 'PENDING',
      });
      await expect(
        svc.parentIce({ sessionId: 's1', userId: 'u1', candidate: '...' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('parentStop', () => {
    it('ACTIVE → ENDED, computes actualSec, enqueues STOP_AUDIO, audits STOPPED, emits', async () => {
      const startedAt = new Date(Date.now() - 30_000);
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        requestedById: 'u1',
        childDeviceId: 'd1',
        state: 'ACTIVE',
        activeAt: startedAt,
        durationSec: 60,
      });
      await svc.parentStop({ sessionId: 's1', userId: 'u1', familyId: 'fam1' });

      expect(prisma.audioSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: 'ENDED',
            actualSec: expect.any(Number),
            endedAt: expect.any(Date),
          }),
        }),
      );
      expect(commands.enqueueAudioStop).toHaveBeenCalledWith('d1', 's1', 'u1');
      expect(events.emitState).toHaveBeenCalledWith('s1', 'ENDED');
    });

    it('idempotent: no-op if already ENDED/FAILED/EXPIRED', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        requestedById: 'u1',
        childDeviceId: 'd1',
        state: 'ENDED',
      });
      await svc.parentStop({ sessionId: 's1', userId: 'u1', familyId: 'fam1' });
      expect(prisma.audioSession.update).not.toHaveBeenCalled();
      expect(commands.enqueueAudioStop).not.toHaveBeenCalled();
    });

    it('rejects (Forbidden) if userId mismatch', async () => {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        requestedById: 'u_other',
        state: 'ACTIVE',
      });
      await expect(
        svc.parentStop({ sessionId: 's1', userId: 'u1', familyId: 'fam1' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('auto-stop', () => {
    it('autoStopIfActive marks ENDED после durationSec timeout', async () => {
      const session = {
        id: 's1',
        requestedById: 'u1',
        childDeviceId: 'd1',
        state: 'ACTIVE',
        activeAt: new Date(),
        durationSec: 60,
      };
      // 1) parentAnswer запустит setTimeout(durationSec * 1000)
      prisma.audioSession.findUnique.mockResolvedValue({
        ...session,
        state: 'READY',
      });
      await svc.parentAnswer({ sessionId: 's1', userId: 'u1', familyId: 'fam1', sdpAnswer: '...' });

      // Между параметрами session обновился — теперь ACTIVE
      prisma.audioSession.findUnique.mockResolvedValue(session);

      // 2) Прокручиваем время на 60s
      jest.advanceTimersByTime(60_000);
      // Дать событийному циклу выполнить async-callbacks
      await Promise.resolve();
      await Promise.resolve();

      expect(prisma.audioSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'ENDED' }),
        }),
      );
    });
  });
});
