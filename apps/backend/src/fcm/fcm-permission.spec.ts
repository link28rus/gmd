import { FcmService } from './fcm.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ChildRealtimeService } from '../child-realtime/child-realtime.service';

test('запрос состояния не останавливается на RuStore без детского обработчика', async () => {
  const realtime = { sendWithAck: jest.fn().mockResolvedValue(false) };
  const svc = new FcmService({} as PrismaService, realtime as unknown as ChildRealtimeService);
  Object.assign(svc, {
    rustoreChildProjectId: 'project-test',
    rustoreChildServiceToken: 'test-token',
  });
  const fcm = jest.spyOn(svc, 'sendDataMessage').mockResolvedValue(true);
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  try {
    expect(
      await svc.sendHybridDataMessage(
        'child',
        { fcmToken: 'fcm', rustorePushToken: 'rustore' },
        { type: 'REPORT_PERMISSION_STATE' },
        { rustore: false },
      ),
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fcm).toHaveBeenCalledTimes(1);
  } finally {
    fcm.mockRestore();
    fetchMock.mockRestore();
  }
});

test('RuStore получает видимое предупреждение; произвольные data-команды остаются тихими', async () => {
  const fetchMock = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue({ ok: true, status: 200 } as Response);
  const svc = new FcmService({} as PrismaService, {} as ChildRealtimeService);
  Object.assign(svc, {
    rustoreParentProjectId: 'project-test',
    rustoreParentServiceToken: 'test-token',
  });
  try {
    await svc.sendHybridToToken({
      tokens: { fcmToken: null, rustorePushToken: 'parent' },
      data: { type: 'PERMISSION_DEGRADED' },
      rustoreNotification: { title: 'Разрешения', body: 'Отключён микрофон' },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.message.notification).toEqual({ title: 'Разрешения', body: 'Отключён микрофон' });
    await svc.sendHybridToToken({
      tokens: { fcmToken: null, rustorePushToken: 'parent' },
      data: { type: 'LOCATION_UPDATED' },
    });
    expect(
      JSON.parse(fetchMock.mock.calls[1][1]!.body as string).message.notification,
    ).toBeUndefined();
  } finally {
    fetchMock.mockRestore();
  }
});
