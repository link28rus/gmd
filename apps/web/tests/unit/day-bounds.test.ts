import { dayBoundsIso, isToday, todayIso, daysAgoIso } from '@/lib/date/day-bounds';

describe('day-bounds', () => {
  const realDate = Date;
  afterEach(() => {
    (global as any).Date = realDate;
  });

  function freezeDate(iso: string) {
    const frozen = new realDate(iso).getTime();
    class MockDate extends realDate {
      constructor(...args: any[]) {
        if (args.length === 0) super(frozen);
        else super(...(args as []));
      }
      static now() {
        return frozen;
      }
    }
    (global as any).Date = MockDate;
  }

  it('dayBoundsIso: [00:00, 23:59:59.999] в локальной TZ, ISO в UTC', () => {
    const [from, to] = dayBoundsIso('2026-04-19');
    const fromD = new realDate(from);
    const toD = new realDate(to);
    expect(fromD.getFullYear()).toBe(2026);
    expect(fromD.getMonth()).toBe(3);
    expect(fromD.getDate()).toBe(19);
    expect(fromD.getHours()).toBe(0);
    expect(toD.getHours()).toBe(23);
    expect(toD.getMinutes()).toBe(59);
    expect(toD.getSeconds()).toBe(59);
    expect(toD.getMilliseconds()).toBe(999);
  });

  it('isToday: true для todayIso', () => {
    freezeDate('2026-04-19T12:00:00.000Z');
    expect(isToday(todayIso())).toBe(true);
    expect(isToday(daysAgoIso(1))).toBe(false);
  });

  it('daysAgoIso: сдвиг на N дней в локальной TZ', () => {
    const frozenIso = '2026-04-19T12:00:00.000Z';
    freezeDate(frozenIso);
    // Важно: expected считаем от ЗАМОРОЖЕННОГО времени, а не от realDate.now() —
    // внутри daysAgoIso вызывается `new Date()` без аргументов, т.е. MockDate,
    // т.е. frozenIso. Если сравнивать с real-системным временем, тест сломается
    // в любой день, кроме 2026-04-19.
    const expected = new realDate(new realDate(frozenIso).getTime() - 86_400_000);
    const yyyy = expected.getFullYear();
    const mm = String(expected.getMonth() + 1).padStart(2, '0');
    const dd = String(expected.getDate()).padStart(2, '0');
    expect(daysAgoIso(1)).toBe(`${yyyy}-${mm}-${dd}`);
  });
});
