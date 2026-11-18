import { AppControlService } from './app-control.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CategoryResolver } from './category-resolver.service';
import { UsageReportBodySchema } from './dto/usage-report.dto';

describe('Даты и приём статистики приложений', () => {
  afterEach(() => jest.useRealTimers());
  it('вчера определяется по часовому поясу ребёнка, а не родителя/сервера', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T18:00:00Z'));
    const db = {
      childDevice: {
        findFirst: jest.fn().mockResolvedValue({ id: 'dev', timezone: 'Asia/Vladivostok' }),
      },
      usageBucket: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AppControlService(db as unknown as PrismaService, {} as CategoryResolver);
    await service.getUsage('child', 'day', 'yesterday');
    expect(db.usageBucket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { childDeviceId: 'dev', date: new Date('2026-11-17T00:00:00Z') },
      }),
    );
  });
  it('пустой успешный отчёт отличается от отсутствия доступа; timezone проверяется', () => {
    expect(
      UsageReportBodySchema.safeParse({ timezone: 'Asia/Vladivostok', buckets: [] }).success,
    ).toBe(true);
    expect(
      UsageReportBodySchema.safeParse({ timezone: 'made-up/timezone', buckets: [] }).success,
    ).toBe(false);
  });
  it('повторяющийся час при DST может содержать два часа использования', () => {
    expect(
      UsageReportBodySchema.safeParse({
        timezone: 'Europe/Berlin',
        buckets: [{ date: '2026-10-25', hour: 2, packageName: 'app', seconds: 7200 }],
      }).success,
    ).toBe(true);
  });
});
