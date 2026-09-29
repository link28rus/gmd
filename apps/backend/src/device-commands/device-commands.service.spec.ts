import { DeviceCommandsService, toPushData } from './device-commands.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { FcmService } from '../fcm/fcm.service';
import type { ChildRealtimeService } from '../child-realtime/child-realtime.service';

// Тесты trogают только listPending, FCM ему не нужен — пустая заглушка.
const fcmStub = {
  isEnabled: () => false,
  isRustoreEnabled: () => false,
  sendDataMessage: jest.fn().mockResolvedValue(false),
  sendHybridDataMessage: jest.fn().mockResolvedValue(false),
} as unknown as FcmService;

const realtimeStub = {
  onDeviceConnected: jest.fn(),
  sendWithAck: jest.fn().mockResolvedValue(false),
} as unknown as ChildRealtimeService;

interface MockCmd {
  id: string;
  type: string;
  status: string;
  childDeviceId: string;
  payload: { sessionId?: string } | null;
  createdAt: Date;
  expiresAt: Date;
}

interface UpdateManyArgs {
  where: {
    childDeviceId?: string;
    status?: string;
    expiresAt?: { lte?: Date; gt?: Date };
    id?: { in: string[] };
  };
  data: Partial<MockCmd>;
}

interface FindManyArgs {
  where: UpdateManyArgs['where'];
  orderBy?: { createdAt?: 'asc' | 'desc' };
}

// Лёгкий мок PrismaService: только методы, которые трогает listPending().
function createPrismaMock(initial: MockCmd[]) {
  const store: MockCmd[] = initial.map((c) => ({ ...c }));
  return {
    deviceCommand: {
      updateMany: jest.fn(async ({ where, data }: UpdateManyArgs) => {
        let updated = 0;
        for (const c of store) {
          let match = true;
          if (where.childDeviceId && c.childDeviceId !== where.childDeviceId) match = false;
          if (where.status && c.status !== where.status) match = false;
          if (where.expiresAt?.lte && c.expiresAt > where.expiresAt.lte) match = false;
          if (where.id?.in && !where.id.in.includes(c.id)) match = false;
          if (match) {
            Object.assign(c, data);
            updated++;
          }
        }
        return { count: updated };
      }),
      findMany: jest.fn(async ({ where, orderBy }: FindManyArgs) => {
        let res = store.filter((c) => {
          if (where.childDeviceId && c.childDeviceId !== where.childDeviceId) return false;
          if (where.status && c.status !== where.status) return false;
          if (where.expiresAt?.gt && c.expiresAt <= where.expiresAt.gt) return false;
          return true;
        });
        if (orderBy?.createdAt === 'asc') {
          res = [...res].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        return res;
      }),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    child: { findFirst: jest.fn() },
    childDevice: { findFirst: jest.fn() },
  } as unknown as PrismaService;
}

describe('DeviceCommandsService.listPending', () => {
  const future = new Date(Date.now() + 60_000);
  const deviceId = 'dev-1';

  it('возвращает все команды если конфликта START/STOP по sessionId нет', async () => {
    const prisma = createPrismaMock([
      {
        id: 'c1',
        type: 'PLAY_SIGNAL',
        status: 'pending',
        childDeviceId: deviceId,
        payload: null,
        createdAt: new Date(Date.now() - 1000),
        expiresAt: future,
      },
      {
        id: 'c2',
        type: 'START_AUDIO',
        status: 'pending',
        childDeviceId: deviceId,
        payload: { sessionId: 's1' },
        createdAt: new Date(Date.now() - 500),
        expiresAt: future,
      },
    ]);
    const svc = new DeviceCommandsService(prisma, fcmStub, realtimeStub);
    const out = await svc.listPending(deviceId);
    expect(out.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('режет START+STOP для одной sessionId и помечает обе expired', async () => {
    const prisma = createPrismaMock([
      {
        id: 'start-1',
        type: 'START_AUDIO',
        status: 'pending',
        childDeviceId: deviceId,
        payload: { sessionId: 'sess-A' },
        createdAt: new Date(Date.now() - 2000),
        expiresAt: future,
      },
      {
        id: 'stop-1',
        type: 'STOP_AUDIO',
        status: 'pending',
        childDeviceId: deviceId,
        payload: { sessionId: 'sess-A' },
        createdAt: new Date(Date.now() - 1000),
        expiresAt: future,
      },
    ]);
    const svc = new DeviceCommandsService(prisma, fcmStub, realtimeStub);
    const out = await svc.listPending(deviceId);
    expect(out).toEqual([]);
    // обе помечены expired в DB
    const updateCalls = (prisma.deviceCommand.updateMany as jest.Mock).mock.calls;
    const expiredCall = updateCalls.find(([arg]) => arg.where.id?.in);
    expect(expiredCall?.[0].where.id.in.sort()).toEqual(['start-1', 'stop-1']);
    expect(expiredCall?.[0].data.status).toBe('expired');
  });

  it('не трогает START_AUDIO для других sessionId если STOP только для одной', async () => {
    const prisma = createPrismaMock([
      {
        id: 'start-A',
        type: 'START_AUDIO',
        status: 'pending',
        childDeviceId: deviceId,
        payload: { sessionId: 'sess-A' },
        createdAt: new Date(Date.now() - 3000),
        expiresAt: future,
      },
      {
        id: 'stop-A',
        type: 'STOP_AUDIO',
        status: 'pending',
        childDeviceId: deviceId,
        payload: { sessionId: 'sess-A' },
        createdAt: new Date(Date.now() - 2000),
        expiresAt: future,
      },
      {
        id: 'start-B',
        type: 'START_AUDIO',
        status: 'pending',
        childDeviceId: deviceId,
        payload: { sessionId: 'sess-B' },
        createdAt: new Date(Date.now() - 1000),
        expiresAt: future,
      },
    ]);
    const svc = new DeviceCommandsService(prisma, fcmStub, realtimeStub);
    const out = await svc.listPending(deviceId);
    expect(out.map((c) => c.id)).toEqual(['start-B']);
  });

  it('одиночный STOP_AUDIO без матчингового START — отдаётся (legacy stop)', async () => {
    const prisma = createPrismaMock([
      {
        id: 'lone-stop',
        type: 'STOP_AUDIO',
        status: 'pending',
        childDeviceId: deviceId,
        payload: { sessionId: 'sess-X' },
        createdAt: new Date(Date.now() - 500),
        expiresAt: future,
      },
    ]);
    const svc = new DeviceCommandsService(prisma, fcmStub, realtimeStub);
    const out = await svc.listPending(deviceId);
    expect(out.map((c) => c.id)).toEqual(['lone-stop']);
  });
});

describe('toPushData (v0.57 realtime replay)', () => {
  it('START_AUDIO → тот же data-map, что уходит в FCM', () => {
    expect(
      toPushData('c1', 'START_AUDIO', {
        sessionId: 's1',
        ws: { url: 'wss://h/audio/ws?x', token: 't', ttlSec: 360 },
        durationSec: 300,
      }),
    ).toEqual({
      type: 'START_AUDIO',
      commandId: 'c1',
      sessionId: 's1',
      wsUrl: 'wss://h/audio/ws?x',
      wsToken: 't',
      ttlSec: '360',
      durationSec: '300',
    });
  });

  it('STOP_AUDIO и PLAY_SIGNAL', () => {
    expect(toPushData('c2', 'STOP_AUDIO', { sessionId: 's1' })).toEqual({
      type: 'STOP_AUDIO',
      commandId: 'c2',
      sessionId: 's1',
    });
    expect(toPushData('c3', 'PLAY_SIGNAL', null)).toEqual({
      type: 'PLAY_SIGNAL',
      commandId: 'c3',
    });
  });

  it('UPLOAD_DIAG (v0.60) → {type, commandId}', () => {
    expect(toPushData('c7', 'UPLOAD_DIAG', null)).toEqual({
      type: 'UPLOAD_DIAG',
      commandId: 'c7',
    });
  });

  it('битый payload и неизвестный тип → null', () => {
    expect(toPushData('c4', 'START_AUDIO', { sessionId: 's1' })).toBeNull();
    expect(toPushData('c5', 'STOP_AUDIO', {})).toBeNull();
    expect(toPushData('c6', 'AUDIO_ANSWER', {})).toBeNull();
  });
});
