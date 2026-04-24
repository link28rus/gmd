import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AudioService } from './audio.service';
import { AudioRelay } from './audio.relay';
import { AudioTokenService } from './audio-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { DeviceCommandsService } from '../device-commands/device-commands.service';

interface PrismaMock {
  child: { findFirst: jest.Mock };
  childDevice: { findFirst: jest.Mock };
  audioSession: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  audioAuditLog: { create: jest.Mock };
}

interface CommandsMock {
  enqueueAudioStart: jest.Mock;
  enqueueAudioStop: jest.Mock;
}

interface RelayMock {
  setCallbacks: jest.Mock;
  terminate: jest.Mock;
}

interface TokensMock {
  issue: jest.Mock;
}

interface SettingsMock {
  getNumber: jest.Mock;
  getBool: jest.Mock;
}

function makePrisma(): PrismaMock {
  return {
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
    audioAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

function makeSettings(): SettingsMock {
  return {
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
}

async function buildService(opts: {
  prisma: PrismaMock;
  settings: SettingsMock;
  commands: CommandsMock;
  relay: RelayMock;
  tokens: TokensMock;
}): Promise<AudioService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AudioService,
      { provide: PrismaService, useValue: opts.prisma },
      { provide: AppSettingsService, useValue: opts.settings },
      { provide: DeviceCommandsService, useValue: opts.commands },
      { provide: AudioRelay, useValue: opts.relay },
      { provide: AudioTokenService, useValue: opts.tokens },
    ],
  }).compile();
  return moduleRef.get(AudioService);
}

describe('AudioService.startSession', () => {
  let svc: AudioService;
  let prisma: PrismaMock;
  let settings: SettingsMock;
  let commands: CommandsMock;
  let relay: RelayMock;
  let tokens: TokensMock;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.AUDIO_WS_PUBLIC_URL = 'wss://gmd.test/audio/ws';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    prisma = makePrisma();
    settings = makeSettings();
    commands = { enqueueAudioStart: jest.fn(), enqueueAudioStop: jest.fn() };
    relay = { setCallbacks: jest.fn(), terminate: jest.fn() };
    tokens = {
      issue: jest
        .fn()
        .mockImplementation((p: { role: string; sub: string }) =>
          Promise.resolve(`jwt-${p.role}-${p.sub}`),
        ),
    };
    svc = await buildService({ prisma, settings, commands, relay, tokens });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('throws NotFoundException if child not in family', async () => {
    prisma.child.findFirst.mockResolvedValue(null);
    await expect(
      svc.startSession({ familyId: 'fam_1', userId: 'u_1', childId: 'c_x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException if no active device', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue(null);
    await expect(
      svc.startSession({ familyId: 'fam_1', userId: 'u_1', childId: 'c_1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException if active session exists', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });
    prisma.audioSession.findFirst.mockResolvedValue({ id: 'sess_active', state: 'ACTIVE' });
    await expect(
      svc.startSession({ familyId: 'fam_1', userId: 'u_1', childId: 'c_1' }),
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
    });
    expect(prisma.audioSession.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durationSec: 1800 }) }),
    );

    await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      durationSec: 5,
    });
    expect(prisma.audioSession.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durationSec: 30 }) }),
    );
  });

  it('issues separate WS tokens for child + parent, enqueues START_AUDIO with child ws', async () => {
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });

    const result = await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      durationSec: 300,
      ip: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(result.state).toBe('PENDING');
    expect(result.ws.url).toContain('wss://gmd.test/audio/ws?role=parent');
    expect(result.ws.url).toContain('token=jwt-parent-u_1');
    expect(result.ws.token).toBe('jwt-parent-u_1');
    expect(result.ws.ttlSec).toBeGreaterThan(300);

    // Token issued for both roles
    const issuedRoles = tokens.issue.mock.calls.map((c) => c[0].role).sort();
    expect(issuedRoles).toEqual(['child', 'parent']);

    // Child получает свой URL+token через DeviceCommand
    expect(commands.enqueueAudioStart).toHaveBeenCalledWith(
      'd_1',
      expect.any(String),
      expect.objectContaining({ url: expect.stringContaining('role=child') }),
      300,
      'u_1',
      expect.any(Number),
    );

    expect(prisma.audioAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event: 'REQUESTED', actorUserId: 'u_1' }),
      }),
    );
  });

  it('hidden mode disabled when settings forbid it', async () => {
    settings.getBool.mockResolvedValue(false);
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });

    await svc.startSession({
      familyId: 'fam_1',
      userId: 'u_1',
      childId: 'c_1',
      hiddenMode: true,
    });

    expect(prisma.audioSession.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hiddenMode: false }) }),
    );
  });

  it('throws if AUDIO_WS_PUBLIC_URL is not set', async () => {
    delete process.env.AUDIO_WS_PUBLIC_URL;
    prisma.child.findFirst.mockResolvedValue({ id: 'c_1', familyId: 'fam_1' });
    prisma.childDevice.findFirst.mockResolvedValue({ id: 'd_1', childId: 'c_1' });

    await expect(
      svc.startSession({ familyId: 'fam_1', userId: 'u_1', childId: 'c_1' }),
    ).rejects.toThrow(/AUDIO_WS_PUBLIC_URL/);

    process.env.AUDIO_WS_PUBLIC_URL = 'wss://gmd.test/audio/ws';
  });
});

describe('AudioService.activateBySessionId', () => {
  let svc: AudioService;
  let prisma: PrismaMock;
  let relay: RelayMock;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.AUDIO_WS_PUBLIC_URL = 'wss://gmd.test/audio/ws';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    prisma = makePrisma();
    relay = { setCallbacks: jest.fn(), terminate: jest.fn() };
    svc = await buildService({
      prisma,
      settings: makeSettings(),
      commands: { enqueueAudioStart: jest.fn(), enqueueAudioStop: jest.fn() },
      relay,
      tokens: { issue: jest.fn() },
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('PENDING → ACTIVE, audits STARTED, schedules autostop', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      state: 'PENDING',
      requestedById: 'u1',
      childDeviceId: 'd1',
      durationSec: 60,
    });
    await svc.activateBySessionId('s1');
    expect(prisma.audioSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { state: 'ACTIVE', activeAt: expect.any(Date) },
    });
    expect(prisma.audioAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event: 'STARTED', actorUserId: 'u1' }),
      }),
    );
  });

  it('idempotent: no-op if already ACTIVE/ENDED/FAILED', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({ id: 's1', state: 'ACTIVE' });
    await svc.activateBySessionId('s1');
    expect(prisma.audioSession.update).not.toHaveBeenCalled();
  });

  it('no-op if session not found', async () => {
    prisma.audioSession.findUnique.mockResolvedValue(null);
    await svc.activateBySessionId('s_missing');
    expect(prisma.audioSession.update).not.toHaveBeenCalled();
  });
});

describe('AudioService.validateSessionForWs', () => {
  let svc: AudioService;
  let prisma: PrismaMock;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.AUDIO_WS_PUBLIC_URL = 'wss://gmd.test/audio/ws';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    prisma = makePrisma();
    svc = await buildService({
      prisma,
      settings: makeSettings(),
      commands: { enqueueAudioStart: jest.fn(), enqueueAudioStop: jest.fn() },
      relay: { setCallbacks: jest.fn(), terminate: jest.fn() },
      tokens: { issue: jest.fn() },
    });
  });

  it('returns session for valid child claim (PENDING)', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      state: 'PENDING',
      childDeviceId: 'd1',
      requestedById: 'u1',
    });
    const r = await svc.validateSessionForWs('s1', 'child', 'd1');
    expect(r?.id).toBe('s1');
  });

  it('returns session for valid parent claim (ACTIVE = reconnect)', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      state: 'ACTIVE',
      childDeviceId: 'd1',
      requestedById: 'u1',
    });
    const r = await svc.validateSessionForWs('s1', 'parent', 'u1');
    expect(r?.id).toBe('s1');
  });

  it('rejects when sub does not match role', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      state: 'PENDING',
      childDeviceId: 'd1',
      requestedById: 'u1',
    });
    expect(await svc.validateSessionForWs('s1', 'child', 'd_other')).toBeNull();
    expect(await svc.validateSessionForWs('s1', 'parent', 'u_other')).toBeNull();
  });

  it('rejects when state is terminal', async () => {
    for (const state of ['ENDED', 'FAILED', 'EXPIRED']) {
      prisma.audioSession.findUnique.mockResolvedValue({
        id: 's1',
        state,
        childDeviceId: 'd1',
        requestedById: 'u1',
      });
      expect(await svc.validateSessionForWs('s1', 'parent', 'u1')).toBeNull();
    }
  });

  it('returns null if session not found', async () => {
    prisma.audioSession.findUnique.mockResolvedValue(null);
    expect(await svc.validateSessionForWs('s_missing', 'parent', 'u1')).toBeNull();
  });
});

describe('AudioService.expireOrFail', () => {
  let svc: AudioService;
  let prisma: PrismaMock;
  let commands: CommandsMock;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.AUDIO_WS_PUBLIC_URL = 'wss://gmd.test/audio/ws';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    prisma = makePrisma();
    commands = { enqueueAudioStart: jest.fn(), enqueueAudioStop: jest.fn() };
    svc = await buildService({
      prisma,
      settings: makeSettings(),
      commands,
      relay: { setCallbacks: jest.fn(), terminate: jest.fn() },
      tokens: { issue: jest.fn() },
    });
  });

  it('marks EXPIRED, audits, enqueues STOP_AUDIO', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      state: 'ACTIVE',
      childDeviceId: 'd1',
      requestedById: 'u1',
      activeAt: new Date(Date.now() - 30_000),
    });
    await svc.expireOrFail('s1', 'EXPIRED', 'NETWORK_ERROR');
    expect(prisma.audioSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'EXPIRED',
          failureReason: 'NETWORK_ERROR',
        }),
      }),
    );
    expect(commands.enqueueAudioStop).toHaveBeenCalledWith('d1', 's1', 'u1');
  });

  it('idempotent: no-op if already terminal', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({ id: 's1', state: 'ENDED' });
    await svc.expireOrFail('s1', 'EXPIRED');
    expect(prisma.audioSession.update).not.toHaveBeenCalled();
  });
});

describe('AudioService.markChildError', () => {
  let svc: AudioService;
  let prisma: PrismaMock;
  let relay: RelayMock;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.AUDIO_WS_PUBLIC_URL = 'wss://gmd.test/audio/ws';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    prisma = makePrisma();
    relay = { setCallbacks: jest.fn(), terminate: jest.fn() };
    svc = await buildService({
      prisma,
      settings: makeSettings(),
      commands: { enqueueAudioStart: jest.fn(), enqueueAudioStop: jest.fn() },
      relay,
      tokens: { issue: jest.fn() },
    });
  });

  it('marks FAILED with reason, audits, terminates relay', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      state: 'ACTIVE',
      childDeviceId: 'd1',
    });
    await svc.markChildError({
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
        }),
      }),
    );
    expect(relay.terminate).toHaveBeenCalledWith('s1', 4008, 'session_failed');
  });

  it('idempotent on terminal state', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      state: 'ENDED',
      childDeviceId: 'd1',
    });
    await svc.markChildError({ sessionId: 's1', deviceId: 'd1', code: 'UNKNOWN' });
    expect(prisma.audioSession.update).not.toHaveBeenCalled();
    expect(relay.terminate).not.toHaveBeenCalled();
  });

  it('rejects (Forbidden) on deviceId mismatch', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      state: 'ACTIVE',
      childDeviceId: 'd_other',
    });
    await expect(
      svc.markChildError({ sessionId: 's1', deviceId: 'd1', code: 'UNKNOWN' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('AudioService.parentStop', () => {
  let svc: AudioService;
  let prisma: PrismaMock;
  let commands: CommandsMock;
  let relay: RelayMock;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.AUDIO_WS_PUBLIC_URL = 'wss://gmd.test/audio/ws';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(async () => {
    prisma = makePrisma();
    commands = { enqueueAudioStart: jest.fn(), enqueueAudioStop: jest.fn() };
    relay = { setCallbacks: jest.fn(), terminate: jest.fn() };
    svc = await buildService({
      prisma,
      settings: makeSettings(),
      commands,
      relay,
      tokens: { issue: jest.fn() },
    });
  });

  it('ACTIVE → ENDED, terminates relay, enqueues STOP_AUDIO', async () => {
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
        data: expect.objectContaining({ state: 'ENDED', endedAt: expect.any(Date) }),
      }),
    );
    expect(commands.enqueueAudioStop).toHaveBeenCalledWith('d1', 's1', 'u1');
    expect(relay.terminate).toHaveBeenCalledWith('s1', 4008, 'session_ended');
  });

  it('idempotent: no-op on terminal state', async () => {
    prisma.audioSession.findUnique.mockResolvedValue({
      id: 's1',
      requestedById: 'u1',
      state: 'ENDED',
    });
    await svc.parentStop({ sessionId: 's1', userId: 'u1', familyId: 'fam1' });
    expect(prisma.audioSession.update).not.toHaveBeenCalled();
    expect(relay.terminate).not.toHaveBeenCalled();
  });

  it('rejects (Forbidden) on userId mismatch', async () => {
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
