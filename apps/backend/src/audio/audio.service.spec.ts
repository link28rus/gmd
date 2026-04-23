import { ConflictException, NotFoundException } from '@nestjs/common';
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
