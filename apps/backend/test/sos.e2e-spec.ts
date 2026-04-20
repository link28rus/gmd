import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { MailerService } from '../src/mailer/mailer.service';
import { seedFamilyWithClaim } from './fixtures/seed';

describe('POST /sos (e2e)', () => {
  let h: TestAppHandle;
  const mailMock = jest.fn();

  beforeAll(async () => {
    h = await bootTestApp();
    // Override MailerService.send globally for this suite
    const mailer = h.app.get(MailerService);
    jest.spyOn(mailer, 'send').mockImplementation(mailMock);
  }, 180_000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await truncateAll(h);
    mailMock.mockReset().mockResolvedValue(undefined);
  });

  it('creates SosEvent + emails parent', async () => {
    const { deviceToken, childId, parentEmail } = await seedFamilyWithClaim(h.app, h.prisma);
    const resp = await request(h.app.getHttpServer())
      .post('/sos')
      .set('X-Child-Token', deviceToken)
      .send({ lat: 55.7558, lon: 37.6173, accuracy: 10, recordedAt: new Date().toISOString() });

    expect(resp.status).toBe(200);
    expect(resp.body.sosId).toBeDefined();
    expect(typeof resp.body.createdAt).toBe('string');

    const events = await h.prisma.sosEvent.findMany({ where: { childId } });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].lat).toBeCloseTo(55.7558);

    expect(mailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: parentEmail,
        subject: expect.stringContaining('SOS'),
      }),
    );
  });

  it('returns 401 without X-Child-Token', async () => {
    const resp = await request(h.app.getHttpServer())
      .post('/sos')
      .send({ lat: 55, lon: 37, recordedAt: new Date().toISOString() });
    expect(resp.status).toBe(401);
  });

  it('returns 400 on invalid lat (> 90)', async () => {
    const { deviceToken } = await seedFamilyWithClaim(h.app, h.prisma);
    const resp = await request(h.app.getHttpServer())
      .post('/sos')
      .set('X-Child-Token', deviceToken)
      .send({ lat: 999, lon: 37, recordedAt: new Date().toISOString() });
    expect(resp.status).toBe(400);
  });

  it('returns 200 even if mailer fails (event already saved)', async () => {
    mailMock.mockRejectedValueOnce(new Error('SMTP down'));
    const { deviceToken, childId } = await seedFamilyWithClaim(h.app, h.prisma);

    const resp = await request(h.app.getHttpServer())
      .post('/sos')
      .set('X-Child-Token', deviceToken)
      .send({ lat: 55, lon: 37, recordedAt: new Date().toISOString() });

    expect(resp.status).toBe(200);
    const events = await h.prisma.sosEvent.findMany({ where: { childId } });
    expect(events.length).toBe(1);
  });

  // Rate-limit test: ThrottlerGuard keys by IP (all supertest requests use 127.0.0.1).
  // We flush Redis before this test to ensure a clean throttle slate.
  // 3 requests should succeed; the 4th must return 429.
  it('enforces rate limit: 3 per 5 min, 4th request → 429', async () => {
    await h.redis.flushdb();
    const { deviceToken } = await seedFamilyWithClaim(h.app, h.prisma);

    for (let i = 0; i < 3; i++) {
      const res = await request(h.app.getHttpServer())
        .post('/sos')
        .set('X-Child-Token', deviceToken)
        .send({ lat: 55, lon: 37, recordedAt: new Date().toISOString() });
      expect(res.status).toBe(200);
    }

    const fourth = await request(h.app.getHttpServer())
      .post('/sos')
      .set('X-Child-Token', deviceToken)
      .send({ lat: 55, lon: 37, recordedAt: new Date().toISOString() });
    expect(fourth.status).toBe(429);
  });
});
