import { computeAgeYears } from './age';

describe('computeAgeYears', () => {
  it('ровно 14 лет в день рождения → 14', () => {
    const dob = new Date('2010-04-19');
    const now = new Date('2024-04-19');
    expect(computeAgeYears(dob, now)).toBe(14);
  });

  it('день до 14-летия → 13', () => {
    const dob = new Date('2010-04-20');
    const now = new Date('2024-04-19');
    expect(computeAgeYears(dob, now)).toBe(13);
  });

  it('день после 14-летия → 14', () => {
    const dob = new Date('2010-04-18');
    const now = new Date('2024-04-19');
    expect(computeAgeYears(dob, now)).toBe(14);
  });

  it('0 лет (только что родился)', () => {
    const dob = new Date('2024-04-19');
    const now = new Date('2024-04-19');
    expect(computeAgeYears(dob, now)).toBe(0);
  });
});
