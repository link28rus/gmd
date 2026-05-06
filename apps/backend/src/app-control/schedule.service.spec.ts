import { ScheduleService } from './schedule.service';

// Pure-логика isActiveAt — основа корректности расписания и на backend, и на
// устройстве (Dart-порт повторит тот же алгоритм). Здесь покрываем все edge-cases:
//   - прямое окно vs cross-midnight
//   - бит дня недели — день попадает / не попадает
//   - DST переходы
//   - полночные TZ-смещения (UTC+05:30 — Asia/Kolkata)
//   - enabled=false / start==end (zero-duration)

const MASK_MON = 1 << 0; // 1
// const MASK_TUE = 1 << 1; // 2 — пока не используется в кейсах
const MASK_WED = 1 << 2; // 4
const MASK_WEEKDAYS = 0b0011111; // 31 (Пн–Пт)
const MASK_WEEKEND = 0b1100000; // 96 (Сб+Вс)
const MASK_ALL = 0b1111111; // 127

/**
 * Создать момент времени, который в указанной TZ выглядит как
 * `YYYY-MM-DDTHH:MM:00`. Делается через локальный Intl-парсинг + поиск UTC ms.
 */
function tzMoment(localISO: string, tz: string): Date {
  // Простой подход: построить Date в UTC, измерить delta до желаемой локальной
  // строки, и сдвинуть. Для тестов хватает 1 итерации.
  const utc = new Date(localISO + 'Z');
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(utc).map((p) => [p.type, p.value]));
  const seenISO = `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}`;
  const drift = new Date(seenISO + 'Z').getTime() - utc.getTime();
  return new Date(utc.getTime() - drift);
}

describe('ScheduleService.isActiveAt', () => {
  describe('disabled / zero-duration', () => {
    it('disabled → false', () => {
      const ok = ScheduleService.isActiveAt(
        { enabled: false, daysMask: MASK_ALL, startMin: 0, endMin: 60 },
        new Date(),
        'UTC',
      );
      expect(ok).toBe(false);
    });

    it('startMin == endMin → false', () => {
      const ok = ScheduleService.isActiveAt(
        { enabled: true, daysMask: MASK_ALL, startMin: 60, endMin: 60 },
        new Date(),
        'UTC',
      );
      expect(ok).toBe(false);
    });
  });

  describe('прямое окно 08:00–22:00', () => {
    const sched = { enabled: true, daysMask: MASK_ALL, startMin: 480, endMin: 1320 };
    const tz = 'Europe/Moscow';

    it('14:00 в нужный день → true', () => {
      // 2026-05-06 — среда
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-06T14:00:00', tz), tz)).toBe(true);
    });
    it('07:59 → false (до окна)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-06T07:59:00', tz), tz)).toBe(
        false,
      );
    });
    it('08:00 → true (включительно)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-06T08:00:00', tz), tz)).toBe(true);
    });
    it('22:00 → false (exclusive end)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-06T22:00:00', tz), tz)).toBe(
        false,
      );
    });
    it('21:59 → true', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-06T21:59:00', tz), tz)).toBe(true);
    });
  });

  describe('cross-midnight 22:00–08:00', () => {
    const sched = { enabled: true, daysMask: MASK_WEEKDAYS, startMin: 1320, endMin: 480 };
    const tz = 'Europe/Moscow';

    it('Пн 22:00 → true (head того же дня)', () => {
      // 2026-05-04 = понедельник
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-04T22:00:00', tz), tz)).toBe(true);
    });
    it('Пн 21:59 → false (до окна)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-04T21:59:00', tz), tz)).toBe(
        false,
      );
    });
    it('Вт 03:00 → true (tail с понедельника, ВТ в маске)', () => {
      // 2026-05-05 = вторник
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-05T03:00:00', tz), tz)).toBe(true);
    });
    it('Вт 07:59 → true (tail c понедельника)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-05T07:59:00', tz), tz)).toBe(true);
    });
    it('Вт 08:00 → false (exclusive end)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-05T08:00:00', tz), tz)).toBe(
        false,
      );
    });
    it('Сб 03:00 → true tail с пятницы, потому что ПТ в маске (5)', () => {
      // 2026-05-09 = суббота, СБ нет в WEEKDAYS, но ПТ есть → tail
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-09T03:00:00', tz), tz)).toBe(true);
    });
    it('Сб 22:00 → false (head, СБ не в WEEKDAYS)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-09T22:00:00', tz), tz)).toBe(
        false,
      );
    });
    it('Вс 03:00 → false (tail с СБ, СБ не в WEEKDAYS)', () => {
      // 2026-05-10 = воскресенье
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-10T03:00:00', tz), tz)).toBe(
        false,
      );
    });
  });

  describe('недельная маска', () => {
    const sched = { enabled: true, daysMask: MASK_WED, startMin: 0, endMin: 1440 - 1 };
    const tz = 'Europe/Moscow';

    it('среда 12:00 → true', () => {
      // 2026-05-06 = среда
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-06T12:00:00', tz), tz)).toBe(true);
    });
    it('четверг 12:00 → false', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-07T12:00:00', tz), tz)).toBe(
        false,
      );
    });
  });

  describe('TZ-семантика', () => {
    const sched = { enabled: true, daysMask: MASK_ALL, startMin: 13 * 60, endMin: 14 * 60 };

    it('окно 13:00–14:00 в Europe/Moscow vs Asia/Vladivostok одновременно', () => {
      // Берём момент когда в Москве 13:30, а во Владивостоке 20:30 (UTC+10)
      const moment = tzMoment('2026-05-06T13:30:00', 'Europe/Moscow');
      expect(ScheduleService.isActiveAt(sched, moment, 'Europe/Moscow')).toBe(true);
      expect(ScheduleService.isActiveAt(sched, moment, 'Asia/Vladivostok')).toBe(false);
    });

    it('UTC+05:30 (India) — корректное определение weekday при полуночном смещении', () => {
      // 2026-05-06 18:00 UTC = 23:30 в Asia/Kolkata (среда)
      // окно 23:00–23:59 (среда), MASK_WED
      const sched2 = { enabled: true, daysMask: MASK_WED, startMin: 23 * 60, endMin: 23 * 60 + 59 };
      const moment = tzMoment('2026-05-06T23:30:00', 'Asia/Kolkata');
      expect(ScheduleService.isActiveAt(sched2, moment, 'Asia/Kolkata')).toBe(true);
    });
  });

  describe('cross-midnight + weekend mask', () => {
    // Сб 23:00 → Вс 06:00, маска = выходные (Сб + Вс)
    const sched = { enabled: true, daysMask: MASK_WEEKEND, startMin: 23 * 60, endMin: 6 * 60 };
    const tz = 'Europe/Moscow';

    it('Сб 23:30 → true (head, СБ в маске)', () => {
      // 2026-05-09 = суббота
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-09T23:30:00', tz), tz)).toBe(true);
    });
    it('Вс 02:00 → true (tail с СБ, СБ в маске)', () => {
      // 2026-05-10 = воскресенье
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-10T02:00:00', tz), tz)).toBe(true);
    });
    it('Вс 23:30 → true (head, ВС в маске)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-10T23:30:00', tz), tz)).toBe(true);
    });
    it('Пн 02:00 → true (tail с ВС, ВС в маске; ПН не в маске, но это ок — tail)', () => {
      // 2026-05-11 = понедельник
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-11T02:00:00', tz), tz)).toBe(true);
    });
    it('Пт 23:30 → false (head, ПТ не в WEEKEND)', () => {
      // 2026-05-08 = пятница
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-08T23:30:00', tz), tz)).toBe(
        false,
      );
    });
  });

  describe('granica polnochi', () => {
    const sched = { enabled: true, daysMask: MASK_MON, startMin: 23 * 60 + 55, endMin: 5 };
    const tz = 'Europe/Moscow';

    it('Пн 23:55 → true', () => {
      // 2026-05-04 = понедельник
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-04T23:55:00', tz), tz)).toBe(true);
    });
    it('Пн 23:54 → false', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-04T23:54:00', tz), tz)).toBe(
        false,
      );
    });
    it('Вт 00:04 → true (tail с ПН, ПН в маске)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-05T00:04:00', tz), tz)).toBe(true);
    });
    it('Вт 00:05 → false (exclusive end)', () => {
      expect(ScheduleService.isActiveAt(sched, tzMoment('2026-05-05T00:05:00', tz), tz)).toBe(
        false,
      );
    });
  });
});
