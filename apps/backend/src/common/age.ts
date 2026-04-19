/**
 * Compute age in full years as of `now`.
 * Birthday not yet reached in the current year → age is (year diff - 1).
 */
export function computeAgeYears(dob: Date, now: Date): number {
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}
