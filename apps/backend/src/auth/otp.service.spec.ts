/* eslint-disable @typescript-eslint/no-explicit-any */
import { OtpService } from './otp.service';
import type { OtpConfig } from './otp.service';
import type { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  _state: any[];
  otpCode: {
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
}

function makePrismaMock(): MockPrisma {
  const otpCodes: any[] = [];
  return {
    _state: otpCodes,
    otpCode: {
      create: jest.fn(({ data }: any) => {
        const row = {
          id: `otp-${otpCodes.length + 1}`,
          attempts: 0,
          consumedAt: null,
          createdAt: new Date(),
          ...data,
        };
        otpCodes.push(row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(({ where }: any) => {
        const match = otpCodes
          .filter(
            (r) => r.email === where.email && r.consumedAt === null && r.expiresAt > new Date(),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return Promise.resolve(match[0] ?? null);
      }),
      update: jest.fn(({ where, data }: any) => {
        const row = otpCodes.find((r) => r.id === where.id);
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        let count = 0;
        otpCodes.forEach((r) => {
          if (r.email === where.email && r.consumedAt === null) {
            Object.assign(r, data);
            count++;
          }
        });
        return Promise.resolve({ count });
      }),
    },
  };
}

const cfg: OtpConfig = { ttlSec: 600, maxAttempts: 3 };

describe('OtpService', () => {
  it('generate создаёт запись в БД, возвращает plain code 6 цифр', async () => {
    const prisma = makePrismaMock();
    const svc = new OtpService(prisma as unknown as PrismaService, cfg);
    const { code } = await svc.generate('a@b.com');
    expect(code).toMatch(/^\d{6}$/);
    expect(prisma._state.length).toBe(1);
    expect(prisma._state[0].codeHash).not.toBe(code);
  });

  it('generate инвалидирует предыдущий активный код на тот же email', async () => {
    const prisma = makePrismaMock();
    const svc = new OtpService(prisma as unknown as PrismaService, cfg);
    await svc.generate('a@b.com');
    await svc.generate('a@b.com');
    const state = prisma._state;
    expect(state[0].consumedAt).not.toBeNull();
    expect(state[1].consumedAt).toBeNull();
  });

  it('verify с правильным кодом возвращает ok=true и помечает consumedAt', async () => {
    const prisma = makePrismaMock();
    const svc = new OtpService(prisma as unknown as PrismaService, cfg);
    const { code } = await svc.generate('a@b.com');
    const r = await svc.verify('a@b.com', code);
    expect(r.ok).toBe(true);
    const row = prisma._state[0];
    expect(row.consumedAt).not.toBeNull();
  });

  it('verify с неправильным кодом инкрементит attempts', async () => {
    const prisma = makePrismaMock();
    const svc = new OtpService(prisma as unknown as PrismaService, cfg);
    await svc.generate('a@b.com');
    const r = await svc.verify('a@b.com', '000000');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_code');
    expect(prisma._state[0].attempts).toBe(1);
  });

  it('после maxAttempts код invalidate, следующие попытки с правильным кодом — invalid_code', async () => {
    const prisma = makePrismaMock();
    const svc = new OtpService(prisma as unknown as PrismaService, cfg);
    const { code } = await svc.generate('a@b.com');
    await svc.verify('a@b.com', '000000');
    await svc.verify('a@b.com', '000000');
    await svc.verify('a@b.com', '000000');
    const r = await svc.verify('a@b.com', code);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_code');
  });

  it('verify если нет активного кода — invalid_code', async () => {
    const prisma = makePrismaMock();
    const svc = new OtpService(prisma as unknown as PrismaService, cfg);
    const r = await svc.verify('a@b.com', '123456');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_code');
  });
});
