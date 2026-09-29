import {
  plural,
  suggestionEvidence,
  suggestionTitle,
  zoneStatsLines,
} from '@/app/cabinet/zones/components/zone-format';

describe('plural', () => {
  it.each([
    [1, 'ночь'],
    [2, 'ночи'],
    [4, 'ночи'],
    [5, 'ночей'],
    [11, 'ночей'],
    [12, 'ночей'],
    [21, 'ночь'],
    [22, 'ночи'],
    [111, 'ночей'],
  ])('%i → %s', (n, word) => {
    expect(plural(n, 'ночь', 'ночи', 'ночей')).toBe(word);
  });
});

describe('подсказки мест', () => {
  const base = { days: 5, daysWithData: 9, typicalFromMin: 490, typicalToMin: 820 };

  it('заголовки', () => {
    expect(suggestionTitle('home')).toBe('Дом?');
    expect(suggestionTitle('school')).toBe('Школа?');
    expect(suggestionTitle('frequent')).toBe('Частое место');
  });

  it('дом — ночи из дней с данными', () => {
    expect(suggestionEvidence('home', { ...base, days: 7 })).toBe('ночует здесь 7 ночей из 9');
  });

  it('школа и частое место — со временем и без', () => {
    expect(suggestionEvidence('school', base)).toBe('по будням с 08:10 до 13:40 — 5 дней');
    expect(suggestionEvidence('frequent', { ...base, days: 3 })).toBe(
      'бывает здесь 3 дня, обычно 08:10–13:40',
    );
    expect(
      suggestionEvidence('school', { ...base, typicalFromMin: null, typicalToMin: null }),
    ).toBe('по будням — 5 дней');
  });
});

describe('zoneStatsLines', () => {
  const empty = {
    visits: 0,
    totalSec: 0,
    avgSec: 0,
    lastVisitFrom: null,
    lastVisitTo: null,
    ongoing: false,
    typicalArrivalMin: null,
    typicalDepartureMin: null,
  };

  it('нет визитов', () => {
    expect(zoneStatsLines(empty)).toEqual(['визитов не было']);
  });

  it('визиты, обычное время и последний визит', () => {
    const lines = zoneStatsLines({
      ...empty,
      visits: 3,
      totalSec: 3 * 5.5 * 3600,
      avgSec: 5.5 * 3600,
      lastVisitFrom: new Date(2026, 8, 29, 8, 10).toISOString(),
      lastVisitTo: new Date(2026, 8, 29, 13, 40).toISOString(),
      typicalArrivalMin: 490,
      typicalDepartureMin: 820,
    });
    expect(lines).toEqual([
      '3 визита · в среднем 5 ч 30 мин · всего 16 ч 30 мин',
      'обычно приходит в 08:10, уходит в 13:40',
      'последний визит: 29.09, 08:10–13:40',
    ]);
  });

  it('ребёнок сейчас в зоне', () => {
    const lines = zoneStatsLines({
      ...empty,
      visits: 1,
      totalSec: 600,
      avgSec: 600,
      ongoing: true,
      lastVisitFrom: new Date(2026, 8, 30, 8, 5).toISOString(),
      lastVisitTo: new Date(2026, 8, 30, 8, 15).toISOString(),
      typicalArrivalMin: 485,
    });
    expect(lines.slice(1)).toEqual(['обычно приходит в 08:05', 'сейчас здесь с 08:05']);
  });
});
