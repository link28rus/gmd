import {
  DAYS_ALL,
  DAYS_WORKDAYS,
  formatDaysMask,
  formatScheduleShort,
  hasDay,
  hhmmToMinutes,
  isOvernight,
  minutesToHHMM,
  toggleDay,
} from '@/app/cabinet/zones/components/zone-format';
import {
  arrivalError,
  arrivalPayload,
  initialArrivalDraft,
  initialScheduleDraft,
  scheduleError,
  schedulePayload,
} from '@/app/cabinet/zones/components/zone-rules-fields';

describe('минуты ↔ HH:MM', () => {
  it.each([
    [0, '00:00'],
    [510, '08:30'],
    [900, '15:00'],
    [1439, '23:59'],
    [1440, '00:00'],
  ])('%i → %s', (min, s) => {
    expect(minutesToHHMM(min)).toBe(s);
  });

  it.each([
    ['08:30', 510],
    ['8:05', 485],
    ['00:00', 0],
    ['23:59', 1439],
    ['24:00', null],
    ['12:60', null],
    ['', null],
    ['abc', null],
  ])('%s → %s', (s, min) => {
    expect(hhmmToMinutes(s)).toBe(min);
  });
});

describe('маска дней: бит 0 = Пн … бит 6 = Вс', () => {
  it('рабочие дни и вся неделя', () => {
    expect(DAYS_WORKDAYS).toBe(31);
    expect(DAYS_ALL).toBe(127);
    expect(hasDay(DAYS_WORKDAYS, 0)).toBe(true);
    expect(hasDay(DAYS_WORKDAYS, 5)).toBe(false);
  });

  it('toggleDay включает и снимает бит', () => {
    expect(toggleDay(0, 0)).toBe(1);
    expect(toggleDay(0, 6)).toBe(64);
    expect(toggleDay(31, 4)).toBe(15);
  });

  it.each([
    [31, 'Пн–Пт'],
    [127, 'ежедневно'],
    [96, 'Сб, Вс'],
    [21, 'Пн, Ср, Пт'],
    [0b1110111, 'Пн–Ср, Пт–Вс'],
    [1, 'Пн'],
    [0, 'дни не выбраны'],
  ])('formatDaysMask(%i) = %s', (mask, text) => {
    expect(formatDaysMask(mask)).toBe(text);
  });

  it('formatScheduleShort', () => {
    expect(formatScheduleShort({ daysMask: 31, startMin: 480, endMin: 900 })).toBe(
      'Пн–Пт 08:00–15:00',
    );
  });

  it('окно через полночь', () => {
    expect(isOvernight(22 * 60, 7 * 60)).toBe(true);
    expect(isOvernight(8 * 60, 15 * 60)).toBe(false);
  });
});

describe('черновики расписания и срока', () => {
  it('выключенные блоки валидны и дают null', () => {
    const s = initialScheduleDraft();
    const a = initialArrivalDraft();
    expect(scheduleError(s)).toBeNull();
    expect(arrivalError(a)).toBeNull();
    expect(schedulePayload(s)).toBeNull();
    expect(arrivalPayload(a)).toBeNull();
  });

  it('расписание: пустые дни, одинаковое время, пустое поле', () => {
    const s = { ...initialScheduleDraft(), on: true };
    expect(scheduleError(s)).toBeNull();
    expect(schedulePayload(s)).toEqual({ daysMask: 31, startMin: 480, endMin: 900 });
    expect(scheduleError({ ...s, daysMask: 0 })).toMatch(/день/);
    expect(scheduleError({ ...s, end: '08:00' })).toMatch(/не должны совпадать/);
    expect(scheduleError({ ...s, start: '' })).toMatch(/Укажите время/);
    expect(scheduleError({ ...s, start: '22:00', end: '07:00' })).toBeNull();
  });

  it('срок: запас 0..120, целое', () => {
    const a = { ...initialArrivalDraft(), on: true };
    expect(arrivalPayload(a)).toEqual({ deadlineMin: 510, daysMask: 31, graceMin: 10 });
    expect(arrivalError({ ...a, grace: '0' })).toBeNull();
    expect(arrivalError({ ...a, grace: '120' })).toBeNull();
    expect(arrivalError({ ...a, grace: '121' })).not.toBeNull();
    expect(arrivalError({ ...a, grace: '-1' })).not.toBeNull();
    expect(arrivalError({ ...a, grace: '5.5' })).not.toBeNull();
    expect(arrivalError({ ...a, grace: '' })).not.toBeNull();
    expect(arrivalError({ ...a, deadline: '' })).toMatch(/срока/);
  });

  it('черновик из существующей зоны', () => {
    const zone = {
      schedule: { daysMask: 96, startMin: 600, endMin: 60 },
      arrival: { deadlineMin: 530, daysMask: 1, graceMin: 0 },
    } as Parameters<typeof initialScheduleDraft>[0];
    expect(initialScheduleDraft(zone)).toEqual({
      on: true,
      daysMask: 96,
      start: '10:00',
      end: '01:00',
    });
    expect(initialArrivalDraft(zone)).toEqual({
      on: true,
      deadline: '08:50',
      daysMask: 1,
      grace: '0',
    });
  });
});
