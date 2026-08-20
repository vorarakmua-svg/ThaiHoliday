import { addDays, isWeekend } from './dates.js';

export interface Observance {
  date: string;
  name_th: string;
}

export interface Substitution {
  date: string;
  substitutes_for: Observance;
}

/**
 * วันหยุดชดเชย: when a statutory holiday lands on a weekend, government offices close
 * on the next working day instead.
 *
 * Observances are processed in date order and each substitution claims its day, so a
 * Saturday/Sunday pair rolls onto Monday and Tuesday rather than colliding. Days already
 * occupied by another holiday are skipped.
 *
 * ครม. can and does override this rule — cabinet resolutions take precedence downstream.
 */
export function computeSubstitutions(observances: Observance[]): Substitution[] {
  const sorted = [...observances].sort((a, b) => a.date.localeCompare(b.date));
  const taken = new Set(sorted.map((o) => o.date));
  const substitutions: Substitution[] = [];

  for (const observance of sorted) {
    if (!isWeekend(observance.date)) continue;

    let candidate = addDays(observance.date, 1);
    // Bounded to a fortnight: a longer walk means the input is malformed, not that
    // Thailand has two solid weeks of holidays.
    for (let guard = 0; guard < 14; guard += 1) {
      if (!isWeekend(candidate) && !taken.has(candidate)) break;
      candidate = addDays(candidate, 1);
    }
    if (isWeekend(candidate) || taken.has(candidate)) continue;

    taken.add(candidate);
    substitutions.push({ date: candidate, substitutes_for: observance });
  }

  return substitutions.sort((a, b) => a.date.localeCompare(b.date));
}
