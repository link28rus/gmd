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
