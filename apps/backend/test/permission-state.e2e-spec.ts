import request from 'supertest';
import { bootTestApp, registerVerifiedUser, truncateAll } from './helpers/test-app';
import type { TestAppHandle } from './helpers/test-app';
import { hashDeviceToken } from '../src/child-device/child-device.service';
import { FcmService } from '../src/fcm/fcm.service';
import { PermissionStateService } from '../src/permission-state/permission-state.service';
import { ParentDevicesService } from '../src/parent-devices/parent-devices.service';

const good = {
  accessibility: null,
  deviceAdmin: true,
  overlay: true,
  notifications: true,
  locationForeground: true,
  locationBackground: true,
  batteryUnrestricted: true,
  usageStats: null,
  microphone: true,
  activityRecognition: true,
  installPackages: true,
};

describe('Состояние разрешений: API и PostgreSQL', () => {
  let h: TestAppHandle;
  let owner: Awaited<ReturnType<typeof registerVerifiedUser>>;
  let childId: string;
  let deviceId: string;
  const token = 'permission-device-test-token';
  let push: jest.SpyInstance;
  beforeAll(async () => {
    h = await bootTestApp();
  }, 180_000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await truncateAll(h);
    owner = await registerVerifiedUser(h, 'permission-owner@example.com');
    const child = await h.prisma.child.create({
      data: { familyId: owner.familyId, name: 'Ребёнок' },
    });
    childId = child.id;
    const device = await h.prisma.childDevice.create({
      data: { childId, tokenHash: hashDeviceToken(token) },
    });
    deviceId = device.id;
    await h.prisma.parentDevice.create({
      data: { userId: owner.userId, fcmToken: 'test-parent-fcm', platform: 'android' },
    });
    push = jest.spyOn(h.app.get(FcmService), 'sendHybridToToken').mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());
  const post = (sequence: number, permissions = good, deviceToken = token) =>
    request(h.app.getHttpServer())
      .post('/child/permission-state')
      .set('X-Child-Token', deviceToken)
      .send({ sequence, permissions });
  const get = (accessToken = owner.accessToken) =>
    request(h.app.getHttpServer())
      .get(`/family/children/${childId}/permission-state`)
      .auth(accessToken, { type: 'bearer' });

  it('требует авторизацию, изолирует семьи, валидирует полный отчёт', async () => {
    await post(1, good, 'invalid').expect(401);
    await post(0).expect(400);
    await request(h.app.getHttpServer())
      .post('/child/permission-state')
      .set('X-Child-Token', token)
      .send({ sequence: 1, permissions: {} })
      .expect(400);
    await get()
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('unknown'));
    const other = await registerVerifiedUser(h, 'other-permission@example.com');
    await get(other.accessToken).expect(404);
    await request(h.app.getHttpServer())
      .post(`/family/children/${childId}/refresh-permission-state`)
      .auth(other.accessToken, { type: 'bearer' })
      .expect(404);
  });
  it('первый отчёт — baseline, конкурирующие повторы создают один push, старый sequence игнорируется', async () => {
    await post(1).expect(200);
    expect(push).not.toHaveBeenCalled();
    const bad = { ...good, microphone: false };
    const results = await Promise.all([post(2, bad), post(2, bad), post(2, bad)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0].data).toMatchObject({ type: 'PERMISSION_DEGRADED', childId });
    await post(1).expect(200);
    await get()
      .expect(200)
      .expect((r) =>
        expect(r.body).toMatchObject({ status: 'degraded', missing: [{ key: 'microphone' }] }),
      );
    await post(3).expect(200);
    expect(push).toHaveBeenCalledTimes(1);
    await get()
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('ok'));
  });
  it('сбой push не теряет событие, повтор отчёта доставляет его; отзыв и новая привязка скрывают старое состояние', async () => {
    await post(1).expect(200);
    push.mockResolvedValueOnce(false);
    await post(2, { ...good, overlay: false }).expect(200);
    expect(await h.prisma.permissionAlert.count({ where: { completedAt: null } })).toBe(1);
    await h.prisma.permissionAlert.updateMany({ data: { retryAt: new Date(0) } });
    await post(3, { ...good, overlay: false }).expect(200);
    expect(push).toHaveBeenCalledTimes(2);
    expect(await h.prisma.permissionAlert.count({ where: { completedAt: null } })).toBe(0);
    await h.prisma.childDevice.update({
      where: { id: deviceId },
      data: { tokenHash: hashDeviceToken('replacement-device-token') },
    });
    await get()
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('unknown'));
    await post(4).expect(401);
    await post(1, { ...good, overlay: false }, 'replacement-device-token').expect(200);
    expect(push).toHaveBeenCalledTimes(2);
    await h.prisma.childDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
    await get()
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('unknown'));
  });
  it('восстановление отменяет ожидающую тревогу и не оживляет её при следующем отказе', async () => {
    await post(1).expect(200);
    push.mockResolvedValue(false);
    await post(2, { ...good, microphone: false }).expect(200);
    await post(3).expect(200);
    await post(4, { ...good, microphone: false }).expect(200);
    expect(await h.prisma.permissionAlert.count({ where: { completedAt: null } })).toBe(1);
  });
  it('не отправляет ожидающую тревогу взрослому, вышедшему из семьи, и по старой привязке', async () => {
    await post(1).expect(200);
    push.mockResolvedValue(false);
    await post(2, { ...good, microphone: false }).expect(200);
    await h.prisma.membership.deleteMany({ where: { userId: owner.userId } });
    await h.prisma.permissionAlert.updateMany({ data: { retryAt: new Date(0) } });
    push.mockClear();
    await h.app.get(PermissionStateService).flush();
    expect(push).not.toHaveBeenCalled();
    expect(await h.prisma.permissionAlert.count({ where: { completedAt: null } })).toBe(0);
  });
  it('выключенная родителем защита и отсутствующий отчёт не дают ложного ОК', async () => {
    await post(1).expect(200);
    await post(2, { ...good, deviceAdmin: false }).expect(200);
    expect(push).not.toHaveBeenCalled();
    await get()
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('ok'));
    await post(3, { ...good, microphone: null } as typeof good).expect(200);
    await get()
      .expect(200)
      .expect((r) => expect(r.body.status).toBe('unknown'));
  });
  it('ошибка измерения между разрешённым и отключённым состоянием не теряет переход', async () => {
    await post(1).expect(200);
    await post(2, { ...good, microphone: null } as typeof good).expect(200);
    await post(3, { ...good, microphone: false }).expect(200);
    expect(push).toHaveBeenCalledTimes(1);
  });
  it('сбой push в полёте не оживляет отменённую после восстановления тревогу', async () => {
    await post(1).expect(200);
    push.mockResolvedValue(false);
    await post(2, { ...good, microphone: false }).expect(200);
    await h.prisma.permissionAlert.updateMany({ data: { retryAt: new Date(0) } });
    let started!: () => void;
    let release!: () => void;
    const inFlight = new Promise<void>((r) => {
      started = r;
    });
    const resume = new Promise<void>((r) => {
      release = r;
    });
    push.mockImplementation(async () => {
      started();
      await resume;
      return false;
    });
    const flushing = h.app.get(PermissionStateService).flush();
    await inFlight;
    try {
      await post(3).expect(200);
    } finally {
      release();
      await flushing;
    }
    expect(await h.prisma.permissionAlert.count({ where: { completedAt: null } })).toBe(0);
  });
  it('параллельный неизменившийся отчёт не открывает уже доставленную тревогу', async () => {
    await post(1).expect(200);
    push.mockResolvedValue(false);
    await post(2, { ...good, microphone: false }).expect(200);
    await h.prisma.permissionAlert.updateMany({ data: { retryAt: new Date(0) } });
    let started!: () => void;
    let release!: () => void;
    let pause = true;
    const snapshotRead = new Promise<void>((r) => {
      started = r;
    });
    const resume = new Promise<void>((r) => {
      release = r;
    });
    h.prisma.$use(async (params, next) => {
      const result = await next(params);
      if (
        pause &&
        params.model === 'PermissionAlert' &&
        params.action === 'findMany' &&
        params.args?.where?.childDeviceId === deviceId
      ) {
        pause = false;
        started();
        await resume;
      }
      return result;
    });
    const reporting = post(3, { ...good, microphone: false })
      .expect(200)
      .then((r) => r);
    await snapshotRead;
    try {
      push.mockResolvedValue(true);
      await h.app.get(PermissionStateService).flush();
    } finally {
      release();
      await reporting;
    }
    expect(await h.prisma.permissionAlert.count({ where: { completedAt: null } })).toBe(0);
  });
  it('вторая реплика соблюдает retryAt и не повторяет неудачную отправку сразу', async () => {
    await post(1).expect(200);
    push.mockResolvedValue(false);
    await post(2, { ...good, microphone: false }).expect(200);
    await h.prisma.permissionAlert.updateMany({ data: { retryAt: new Date(0) } });
    push.mockClear();
    let started!: () => void;
    let release!: () => void;
    let pause = true;
    const selected = new Promise<void>((r) => {
      started = r;
    });
    const resume = new Promise<void>((r) => {
      release = r;
    });
    h.prisma.$use(async (params, next) => {
      const result = await next(params);
      if (
        pause &&
        params.model === 'PermissionAlert' &&
        params.action === 'findMany' &&
        params.args?.where?.childDeviceId === undefined
      ) {
        pause = false;
        started();
        await resume;
      }
      return result;
    });
    const other = new PermissionStateService(
      h.prisma,
      h.app.get(FcmService),
      h.app.get(ParentDevicesService),
    );
    const second = other.flush();
    await selected;
    try {
      await h.app.get(PermissionStateService).flush();
    } finally {
      release();
      await second;
    }
    expect(push).toHaveBeenCalledTimes(1);
  });
  it('отключённые функции принимают только null; разные отзывы имеют независимые уведомления', async () => {
    for (const key of ['accessibility', 'usageStats']) {
      await request(h.app.getHttpServer())
        .post('/child/permission-state')
        .set('X-Child-Token', token)
        .send({ sequence: 1, permissions: { ...good, [key]: false } })
        .expect(400);
    }
    await post(1).expect(200);
    await post(2, { ...good, microphone: false }).expect(200);
    await post(3, { ...good, microphone: false, overlay: false }).expect(200);
    expect(push.mock.calls[1][0].data.permissionLabels).toContain('Микрофон');
    expect(push.mock.calls[1][0].data.permissionLabels).toContain('Поверх других приложений');
    expect(push.mock.calls[0][0].collapseKey).toBeUndefined();
    expect(push.mock.calls[1][0].collapseKey).toBeUndefined();
    expect(push.mock.calls[0][0].data.alertId).not.toBe(push.mock.calls[1][0].data.alertId);
  });
  it('запрос отчёта использует только каналы с обработчиком и отражает отказ доставки', async () => {
    const send = jest
      .spyOn(h.app.get(FcmService), 'sendHybridDataMessage')
      .mockResolvedValue(false);
    await request(h.app.getHttpServer())
      .post(`/family/children/${childId}/refresh-permission-state`)
      .auth(owner.accessToken, { type: 'bearer' })
      .expect(200)
      .expect((r) => expect(r.body.requested).toBe(false));
    expect(send).toHaveBeenCalledWith(
      deviceId,
      expect.anything(),
      { type: 'REPORT_PERMISSION_STATE' },
      { rustore: false },
    );
  });
});
