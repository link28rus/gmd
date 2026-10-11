/* eslint-disable @typescript-eslint/no-explicit-any */
import { FindPhoneService } from './find-phone.service';

function setup(device: Record<string, unknown>) {
  const prisma = {
    membership: { findMany: jest.fn().mockResolvedValue([]) },
    parentLocationDevice: {
      findFirst: jest.fn().mockResolvedValue(device),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const fcm = { sendHybridToToken: jest.fn().mockResolvedValue(true) };
  const svc = new FindPhoneService(prisma as any, fcm as any, {} as any, {} as any);
  return { svc, prisma, fcm };
}

const baseDevice = {
  id: 'pd1',
  userId: 'u1',
  fcmToken: 'fcm-1',
  signalId: null,
  signalRequestedAt: null,
  signalAckedAt: null,
};

describe('FindPhoneService.requestSignal', () => {
  it('новый сигнал пишется условно по прежнему signalId и уходит в push', async () => {
    const { svc, prisma, fcm } = setup(baseDevice);
    prisma.parentLocationDevice.updateMany.mockResolvedValue({ count: 1 });
    const res = await svc.requestSignal('u1', 'pd1');
    expect(prisma.parentLocationDevice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pd1', signalId: null } }),
    );
    expect(fcm.sendHybridToToken).toHaveBeenCalledWith(
      expect.objectContaining({ data: { type: 'PLAY_SIGNAL', signalId: res.signalId } }),
    );
  });

  it('проиграл гонку параллельному нажатию — отдаёт и шлёт сигнал победителя', async () => {
    const { svc, prisma, fcm } = setup(baseDevice);
    const winnerAt = new Date('2026-10-12T10:00:00.000Z');
    prisma.parentLocationDevice.updateMany.mockResolvedValue({ count: 0 });
    prisma.parentLocationDevice.findUnique.mockResolvedValue({
      signalId: 'winner',
      signalRequestedAt: winnerAt,
    });
    const res = await svc.requestSignal('u1', 'pd1');
    expect(res.signalId).toBe('winner');
    expect(res.requestedAt).toBe(winnerAt.toISOString());
    expect(fcm.sendHybridToToken).toHaveBeenCalledWith(
      expect.objectContaining({ data: { type: 'PLAY_SIGNAL', signalId: 'winner' } }),
    );
  });
});
