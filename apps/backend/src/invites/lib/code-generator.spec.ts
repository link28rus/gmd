import { generateInviteCode, normalizeInviteCode, CROCKFORD_ALPHABET } from './code-generator';

describe('generateInviteCode', () => {
  it('возвращает 8 chars', () => {
    const c = generateInviteCode();
    expect(c).toHaveLength(8);
  });

  it('все символы из Crockford алфавита', () => {
    for (let i = 0; i < 1000; i++) {
      const c = generateInviteCode();
      for (const ch of c) {
        expect(CROCKFORD_ALPHABET).toContain(ch);
      }
    }
  });

  it('никогда не возвращает I/L/O/U', () => {
    for (let i = 0; i < 1000; i++) {
      const c = generateInviteCode();
      expect(c).not.toMatch(/[ILOU]/);
    }
  });

  it('распределение равномерное (грубый тест)', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10000; i++) {
      for (const ch of generateInviteCode()) {
        counts[ch] = (counts[ch] ?? 0) + 1;
      }
    }
    const values = Object.values(counts);
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(min).toBeGreaterThan(1700);
    expect(max).toBeLessThan(3300);
  });
});

describe('normalizeInviteCode', () => {
  it('приводит к uppercase', () => {
    expect(normalizeInviteCode('k4hj9xpn')).toBe('K4HJ9XPN');
  });

  it('обрезает пробелы и тире', () => {
    expect(normalizeInviteCode(' K4HJ-9XPN ')).toBe('K4HJ9XPN');
  });
});
