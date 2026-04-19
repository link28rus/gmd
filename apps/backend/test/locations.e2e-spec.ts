import request from 'supertest';
import { bootTestApp, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { CONSENT_CONFIG } from '../src/consent/consent.tokens';
import { LocationsService } from '../src/locations/locations.service';

describe('Locations (e2e)', () => {
  let h: TestAppHandle;

  beforeAll(async () => {
    h = await bootTestApp();
  }, 180_000);

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await truncateAll(h);
    // reset consent version to 1.0 between tests
    const cfg = h.app.get(CONSENT_CONFIG);
    cfg.privacyPolicyVersion = '1.0';
    // flush consent cache inside LocationsService
    h.app.get(LocationsService).clearConsentCache();
  });

  async function registerParent(email: string): Promise<{ accessToken: string; userId: string }> {
    const server = h.app.getHttpServer();
    await request(server).post('/auth/request-otp').send({ email }).expect(202);
    const code = h.delivery.lastCodeFor(email);
    if (!code) throw new Error('no code');
    const v = await request(server).post('/auth/verify-otp').send({ email, code }).expect(200);
    return { accessToken: v.body.accessToken, userId: v.body.user.id };
  }

  async function setupFlow(): Promise<{
    accessToken: string;
    childId: string;
    deviceToken: string;
  }> {
    const server = h.app.getHttpServer();
    const { accessToken } = await registerParent('parent@x.com');
    // Note: user already has consent (accepted at registration matching current version 1.0)

    const c = await request(server)
      .post('/family/children')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Kid' })
      .expect(201);
    const childId = c.body.child.id as string;

    const inv = await request(server)
      .post(`/family/children/${childId}/invites`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    const claim = await request(server)
      .post('/child/claim')
      .send({ code: inv.body.code })
      .expect(200);
    return { accessToken, childId, deviceToken: claim.body.deviceToken as string };
  }

  it('ingest → latest → list happy path', async () => {
    const server = h.app.getHttpServer();
    const { accessToken, childId, deviceToken } = await setupFlow();
    const now = Date.now();
    const points = [
      { lat: 55.1, lon: 37.1, recordedAt: new Date(now - 60_000).toISOString() },
      { lat: 55.2, lon: 37.2, recordedAt: new Date(now - 30_000).toISOString() },
    ];
    const ing = await request(server)
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points })
      .expect(200);
    expect(ing.body).toMatchObject({ accepted: 2, rejected: 0 });

    const latest = await request(server)
      .get(`/children/${childId}/location/latest`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(latest.body.lat).toBeCloseTo(55.2);
    expect(latest.body.lon).toBeCloseTo(37.2);

    const list = await request(server)
      .get(`/children/${childId}/locations`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body.items).toHaveLength(2);
  });

  it('returns 423 consent_required when owner has not accepted current version', async () => {
    const server = h.app.getHttpServer();
    const { deviceToken } = await setupFlow();
    // bump current policy version — owner has accepted 1.0, now current is 2.0
    const cfg = h.app.get(CONSENT_CONFIG);
    cfg.privacyPolicyVersion = '2.0';
    h.app.get(LocationsService).clearConsentCache();

    const res = await request(server)
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({
        points: [{ lat: 55, lon: 37, recordedAt: new Date().toISOString() }],
      })
      .expect(423);
    expect(res.body.error.code).toBe('consent_required');
    expect(res.body.error.currentPolicyVersion).toBe('2.0');
  });

  it('returns 413 when batch > 100', async () => {
    const server = h.app.getHttpServer();
    const { deviceToken } = await setupFlow();
    const now = Date.now();
    const points = Array.from({ length: 101 }, (_, i) => ({
      lat: 55,
      lon: 37,
      recordedAt: new Date(now - i * 1000).toISOString(),
    }));
    const res = await request(server)
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points })
      .expect(413);
    expect(res.body.error.code).toBe('batch_too_large');
  });

  it("returns 404 child_not_found for another user's child", async () => {
    const server = h.app.getHttpServer();
    const { childId } = await setupFlow();
    const { accessToken: otherToken } = await registerParent('other@x.com');
    const res = await request(server)
      .get(`/children/${childId}/location/latest`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    expect(res.body.error.code).toBe('child_not_found');
  });

  it('idempotent: same (device, recordedAt) twice → second is duplicate', async () => {
    const server = h.app.getHttpServer();
    const { deviceToken } = await setupFlow();
    const ts = new Date(Date.now() - 60_000).toISOString();
    const point = { lat: 55, lon: 37, recordedAt: ts };
    await request(server)
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points: [point] })
      .expect(200);
    const second = await request(server)
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({ points: [point] })
      .expect(200);
    expect(second.body).toMatchObject({
      accepted: 0,
      rejected: 1,
      rejectedReasons: { duplicate: 1 },
    });
  });

  it('PostGIS geom is populated from lat/lon', async () => {
    const server = h.app.getHttpServer();
    const { deviceToken } = await setupFlow();
    const ts = new Date(Date.now() - 30_000).toISOString();
    await request(server)
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({
        points: [{ lat: 55.75, lon: 37.62, recordedAt: ts }],
      })
      .expect(200);
    const rows = (await h.prisma.$queryRawUnsafe(
      'SELECT ST_X(geom::geometry) AS lon, ST_Y(geom::geometry) AS lat FROM locations LIMIT 1',
    )) as Array<{ lat: number; lon: number }>;
    expect(rows[0].lat).toBeCloseTo(55.75, 5);
    expect(rows[0].lon).toBeCloseTo(37.62, 5);
  });

  it('retention DELETE removes rows older than 30 days', async () => {
    const server = h.app.getHttpServer();
    const { deviceToken, childId } = await setupFlow();
    // Insert a fresh valid point via API
    await request(server)
      .post('/child/locations')
      .set('X-Child-Token', deviceToken)
      .send({
        points: [{ lat: 55, lon: 37, recordedAt: new Date(Date.now() - 60_000).toISOString() }],
      })
      .expect(200);
    // Inject an old row directly using the real device id
    await h.prisma.$executeRawUnsafe(
      `INSERT INTO locations (id, "childId", "childDeviceId", lat, lon, "recordedAt", "serverReceivedAt")
       SELECT 'old_' || substr(md5(random()::text), 1, 20), "childId", id, 55, 37, now() - interval '31 days', now()
       FROM child_devices WHERE "childId" = $1`,
      childId,
    );
    const before = (await h.prisma.$queryRawUnsafe(
      'SELECT count(*)::int AS n FROM locations',
    )) as Array<{ n: number }>;
    expect(before[0].n).toBe(2);
    await h.prisma.$executeRawUnsafe(
      `DELETE FROM locations WHERE "recordedAt" < now() - interval '30 days'`,
    );
    const after = (await h.prisma.$queryRawUnsafe(
      'SELECT count(*)::int AS n FROM locations',
    )) as Array<{ n: number }>;
    expect(after[0].n).toBe(1);
  });
});
