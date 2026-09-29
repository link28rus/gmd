import {
  dayBit,
  formatMinute,
  isValidTimeZone,
  isZoneScheduleActive,
  zoneLocalParts,
} from './zone-time';

const VL = 'Asia/Vladivostok'; // UTC+10, без перехода на летнее время

describe('zone-time', () => {
  it('местные части: дата, день недели, минута', () => {
    // 2026-09-29 (вторник) 22:30 UTC = 2026-09-30 (среда) 08:30 во Владивостоке
    const p = zoneLocalParts(new Date('2026-09-29T22:30:00Z'), VL);
    expect(p).toEqual({ weekday: 3, minute: 510, date: '2026-09-30' });
  });

  it('полночь — минута 0, а не 1440', () => {
    expect(zoneLocalParts(new Date('2026-09-29T14:00:00Z'), VL).minute).toBe(0);
  });

  it('маска дней: бит0 — понедельник', () => {
    expect(dayBit(1)).toBe(1);
    expect(dayBit(7)).toBe(64);
  });

  it('проверка пояса', () => {
    expect(isValidTimeZone(VL)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('окно расписания в будни 08:00–15:00', () => {
    const s = { daysMask: 31, startMin: 480, endMin: 900 };
    expect(isZoneScheduleActive(s, new Date('2026-09-29T22:30:00Z'), VL)).toBe(true); // ср 08:30
    expect(isZoneScheduleActive(s, new Date('2026-09-30T06:00:00Z'), VL)).toBe(false); // ср 16:00
    expect(isZoneScheduleActive(s, new Date('2026-10-03T00:00:00Z'), VL)).toBe(false); // сб 10:00
  });

  it('окно через полночь 21:00–07:00: хвост вчерашнего дня', () => {
    const s = { daysMask: 1, startMin: 1260, endMin: 420 }; // только понедельник
    expect(isZoneScheduleActive(s, new Date('2026-09-28T12:00:00Z'), VL)).toBe(true); // пн 22:00
    expect(isZoneScheduleActive(s, new Date('2026-09-28T19:00:00Z'), VL)).toBe(true); // вт 05:00
    expect(isZoneScheduleActive(s, new Date('2026-09-29T12:00:00Z'), VL)).toBe(false); // вт 22:00
  });

  it('formatMinute', () => {
    expect(formatMinute(510)).toBe('08:30');
    expect(formatMinute(0)).toBe('00:00');
  });
});
