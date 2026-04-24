import { AudioTokenService } from './audio-token.service';

describe('AudioTokenService', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(() => {
    process.env.AUDIO_WS_SECRET = 'test-secret-very-long-32+chars-please-rotate-me';
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('issued token verifies and returns claims', async () => {
    const svc = new AudioTokenService();
    const tok = await svc.issue({ sessionId: 's1', role: 'child', sub: 'd1', ttlSec: 60 });
    const claims = await svc.verify(tok);
    expect(claims).not.toBeNull();
    expect(claims?.sid).toBe('s1');
    expect(claims?.role).toBe('child');
    expect(claims?.sub).toBe('d1');
    expect(claims?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('returns null for invalid signature', async () => {
    const svc = new AudioTokenService();
    const tok = await svc.issue({ sessionId: 's1', role: 'child', sub: 'd1', ttlSec: 60 });
    const tampered = tok.slice(0, -4) + 'AAAA';
    expect(await svc.verify(tampered)).toBeNull();
  });

  it('returns null for malformed token', async () => {
    const svc = new AudioTokenService();
    expect(await svc.verify('not-a-jwt')).toBeNull();
    expect(await svc.verify('')).toBeNull();
  });

  it('returns null for expired token', async () => {
    const svc = new AudioTokenService();
    // ttl=1s — заведомо истёк к моменту проверки.
    const tok = await svc.issue({ sessionId: 's1', role: 'parent', sub: 'u1', ttlSec: 1 });
    await new Promise((r) => setTimeout(r, 1100));
    expect(await svc.verify(tok)).toBeNull();
  });

  it('throws on missing AUDIO_WS_SECRET', async () => {
    delete process.env.AUDIO_WS_SECRET;
    const svc = new AudioTokenService();
    await expect(
      svc.issue({ sessionId: 's', role: 'child', sub: 'd', ttlSec: 60 }),
    ).rejects.toThrow(/AUDIO_WS_SECRET/);
    process.env.AUDIO_WS_SECRET = 'test-secret-very-long-32+chars-please-rotate-me';
  });

  it('throws on too-short AUDIO_WS_SECRET', async () => {
    process.env.AUDIO_WS_SECRET = 'short';
    const svc = new AudioTokenService();
    await expect(
      svc.issue({ sessionId: 's', role: 'child', sub: 'd', ttlSec: 60 }),
    ).rejects.toThrow(/AUDIO_WS_SECRET/);
    process.env.AUDIO_WS_SECRET = 'test-secret-very-long-32+chars-please-rotate-me';
  });
});
