/* eslint-disable @typescript-eslint/no-explicit-any */
import { ChildRealtimeGateway } from './child-realtime.gateway';
import type { ChildDeviceService } from '../child-device/child-device.service';
import type { ChildRealtimeService } from './child-realtime.service';

const STATE_KEY = (client: object) =>
  Object.getOwnPropertySymbols(client).find((s) => s.description === 'child-realtime-state');

function setup() {
  const devices = {
    touchLastSeen: jest.fn(),
    setAppVersion: jest.fn().mockResolvedValue(undefined),
    setMicReady: jest.fn().mockResolvedValue(true),
  };
  const realtime = { handleAck: jest.fn() };
  const gw = new ChildRealtimeGateway(
    devices as unknown as ChildDeviceService,
    realtime as unknown as ChildRealtimeService,
  );
  // Эмулируем уже авторизованный сокет: handleConnection кладёт состояние под
  // приватный Symbol — достаём его через реальное подключение.
  const client: any = {
    OPEN: 1,
    readyState: 1,
    on: jest.fn(),
    send: jest.fn(),
  };
  return { gw, devices, realtime, client };
}

async function connect(gw: ChildRealtimeGateway, devices: any, client: any) {
  devices.verifyToken = jest.fn().mockResolvedValue({ deviceId: 'dev-1' });
  (gw as any).realtime.register = jest.fn();
  (gw as any).realtime.connectedCount = jest.fn().mockReturnValue(1);
  await gw.handleConnection(client, { headers: { 'x-child-token': 't' } } as any);
  expect(STATE_KEY(client)).toBeDefined();
}

function send(gw: ChildRealtimeGateway, client: any, msg: unknown) {
  (gw as any).handleMessage(client, typeof msg === 'string' ? msg : JSON.stringify(msg));
}

describe('ChildRealtimeGateway — micReady (v0.62)', () => {
  it('hello с boolean micReady пишет appVersion и micReady', async () => {
    const { gw, devices, client } = setup();
    await connect(gw, devices, client);
    send(gw, client, { op: 'hello', appVersion: '0.62.0', micReady: false });
    expect(devices.setAppVersion).toHaveBeenCalledWith('dev-1', '0.62.0');
    expect(devices.setMicReady).toHaveBeenCalledWith('dev-1', false);
  });

  it('hello без micReady (старое приложение) не трогает micReady', async () => {
    const { gw, devices, client } = setup();
    await connect(gw, devices, client);
    send(gw, client, { op: 'hello', appVersion: '0.61.0' });
    expect(devices.setAppVersion).toHaveBeenCalled();
    expect(devices.setMicReady).not.toHaveBeenCalled();
  });

  it('status с boolean micReady пишет micReady', async () => {
    const { gw, devices, client } = setup();
    await connect(gw, devices, client);
    send(gw, client, { op: 'status', micReady: true });
    expect(devices.setMicReady).toHaveBeenCalledWith('dev-1', true);
  });

  it.each([['true'], [1], [null], [{}]])(
    'status с не-boolean micReady=%p игнорируется',
    async (v) => {
      const { gw, devices, client } = setup();
      await connect(gw, devices, client);
      send(gw, client, { op: 'status', micReady: v });
      send(gw, client, { op: 'hello', micReady: v });
      expect(devices.setMicReady).not.toHaveBeenCalled();
    },
  );

  it('битый JSON и сообщение без авторизации игнорируются', async () => {
    const { gw, devices, client } = setup();
    send(gw, client, { op: 'status', micReady: true }); // нет состояния сокета
    await connect(gw, devices, client);
    send(gw, client, '{not json');
    expect(devices.setMicReady).not.toHaveBeenCalled();
  });
});
