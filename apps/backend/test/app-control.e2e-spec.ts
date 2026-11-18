import request from 'supertest';
import { GenericContainer } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { bootTestApp, registerVerifiedUser, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { hashDeviceToken } from '../src/child-device/child-device.service';
import { FcmService } from '../src/fcm/fcm.service';

describe('Контроль приложений: API, миграция и PostgreSQL', () => {
  let h: TestAppHandle;
  let redis: StartedTestContainer;
  let owner: Awaited<ReturnType<typeof registerVerifiedUser>>;
  let childId: string;
  let deviceId: string;
  const token = 'app-control-device-token';
  const date = new Date().toISOString().slice(0, 10);
  beforeAll(async () => {
    // Собственный Redis: flushdb общего харнесса не касается чужого dev-стенда.
    redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    h = await bootTestApp();
  }, 180_000);
  afterAll(async () => {
    await h?.close();
    await redis?.stop();
  });
  beforeEach(async () => {
    await truncateAll(h);
    owner = await registerVerifiedUser(h, 'app-control@example.com');
    await h.prisma.user.update({
      where: { id: owner.userId },
      data: { acceptedPrivacyPolicyVersion: '1.0' },
    });
    const child = await h.prisma.child.create({
      data: { familyId: owner.familyId, name: 'Ребёнок' },
    });
    childId = child.id;
    const device = await h.prisma.childDevice.create({
      data: { childId, tokenHash: hashDeviceToken(token) },
    });
    deviceId = device.id;
    jest.spyOn(h.app.get(FcmService), 'sendHybridDataMessage').mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());
  const usage = (seconds: number, deviceToken = token, epoch = '1') =>
    request(h.app.getHttpServer())
      .post('/child/usage-reports')
      .set('X-Child-Token', deviceToken)
      .send({ timezone: 'UTC', buckets: [{ date, hour: 1, packageName: 'game', seconds, epoch }] });
  const total = () =>
    request(h.app.getHttpServer())
      .get(`/family/children/${childId}/app-control/usage?date=${date}`)
      .auth(owner.accessToken, { type: 'bearer' });

  it('сохраняет исторический вклад и идемпотентно добавляет новые привязки и периоды', async () => {
    await h.prisma.usageBucket.create({
      data: {
        childDeviceId: deviceId,
        date: new Date(date),
        hour: 1,
        packageName: 'game',
        seconds: 3000,
      },
    });
    await usage(60).expect(204);
    await usage(60).expect(204);
    expect((await total().expect(200)).body.result.totalSeconds).toBe(3060);
    const nextToken = 'replacement-device-token';
    await h.prisma.childDevice.update({
      where: { id: deviceId },
      data: { tokenHash: hashDeviceToken(nextToken) },
    });
    await usage(120, nextToken).expect(204);
    expect((await total().expect(200)).body.result.totalSeconds).toBe(3180);
    await usage(60, nextToken).expect(204); // Поздний ответ старого HTTP-запроса.
    expect((await total().expect(200)).body.result.totalSeconds).toBe(3180);
    await usage(30, nextToken, '2').expect(204);
    expect((await total().expect(200)).body.result.totalSeconds).toBe(3210);
    await usage(200, token).expect(401);
  });
  it('подтверждает только текущие правила, не раскрывает bindingHash и изолирует семью', async () => {
    await request(h.app.getHttpServer()).get('/child/app-control-state').expect(401);
    const config = await request(h.app.getHttpServer())
      .get('/child/app-control-state')
      .set('X-Child-Token', token)
      .expect(200);
    expect(config.body.bindingHash).toBeUndefined();
    await request(h.app.getHttpServer())
      .post('/child/app-control-state/ack')
      .set('X-Child-Token', token)
      .send({
        revision: config.body.revision,
        accessibility: true,
        usageStats: true,
        timezone: 'UTC',
      })
      .expect(204);
    const status = () =>
      request(h.app.getHttpServer())
        .get(`/family/children/${childId}/app-control/status`)
        .auth(owner.accessToken, { type: 'bearer' });
    expect((await status().expect(200)).body.applied).toBe(true);
    await request(h.app.getHttpServer())
      .put(`/family/children/${childId}/app-control/app-rules/game`)
      .auth(owner.accessToken, { type: 'bearer' })
      .send({ mode: 'ALWAYS_ALLOWED' })
      .expect(200);
    expect((await status().expect(200)).body.applied).toBe(false);
    const other = await registerVerifiedUser(h, 'other-family@example.com');
    await request(h.app.getHttpServer())
      .get(`/family/children/${childId}/app-control/status`)
      .auth(other.accessToken, { type: 'bearer' })
      .expect(404);
  });
  it('снимок включает активные зоны этого ребёнка и очищается после выключения и удаления', async () => {
    const app = h.app.getHttpServer();
    const zone = {
      name: 'Школа',
      color: '#22c55e',
      icon: 'school',
      centerLat: 48.48,
      centerLon: 135.08,
      radius: 150,
    };
    const parent = (method: 'post' | 'patch' | 'delete', path: string) =>
      request(app)[method](path).auth(owner.accessToken, { type: 'bearer' });
    const childState = async () =>
      (await request(app).get('/child/app-control-state').set('X-Child-Token', token).expect(200))
        .body;

    const other = await registerVerifiedUser(h, 'other-zone-family@example.com');
    await h.prisma.zone.create({
      data: {
        ...zone,
        familyId: other.familyId,
        createdBy: other.userId,
        allChildren: true,
        blockApps: true,
      },
    });
    const sibling = await h.prisma.child.create({
      data: { familyId: owner.familyId, name: 'Сестра' },
    });
    await parent('post', '/zones')
      .send({ ...zone, blockApps: true, childIds: [sibling.id] })
      .expect(201);
    const original = await childState();
    expect(original.blockingZones).toEqual([]);

    const created = await parent('post', '/zones')
      .send({ ...zone, childIds: [childId] })
      .expect(201);
    const { id } = created.body;
    expect(created.body.blockApps).toBe(false);
    await parent('patch', `/zones/${id}`).send({ blockApps: true }).expect(200);
    const active = await childState();
    expect(active.blockingZones).toEqual([
      { id, name: zone.name, centerLat: zone.centerLat, centerLon: zone.centerLon, radius: 150 },
    ]);
    expect(active.revision).not.toBe(original.revision);

    await parent('patch', `/zones/${id}`).send({ radius: 200 }).expect(200);
    expect((await childState()).blockingZones[0].radius).toBe(200);
    await parent('patch', `/zones/${id}`).send({ blockApps: false }).expect(200);
    expect((await childState()).blockingZones).toEqual([]);
    await parent('patch', `/zones/${id}`).send({ blockApps: true }).expect(200);
    await parent('delete', `/zones/${id}`).expect(204);
    expect((await childState()).blockingZones).toEqual([]);
  });
  it('пустой отчёт имеет свежесть; отозванный токен не меняет новую привязку', async () => {
    await request(h.app.getHttpServer())
      .post('/child/usage-reports')
      .set('X-Child-Token', token)
      .send({ timezone: 'UTC', buckets: [] })
      .expect(204);
    const device = await h.prisma.childDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.usageReportedAt).not.toBeNull();
    await h.prisma.childDevice.update({
      where: { id: deviceId },
      data: { tokenHash: hashDeviceToken('new-device') },
    });
    await request(h.app.getHttpServer())
      .post('/child/app-control-state/ack')
      .set('X-Child-Token', token)
      .send({ revision: 'a'.repeat(64), accessibility: true, usageStats: true, timezone: 'UTC' })
      .expect(401);
  });
});
