import { HolidayYear } from './schema.js';
import { isWeekend } from './rules/dates.js';

/**
 * Checks run on every pull request, above and beyond the schema.
 *
 * These are the invariants that would let a bad parse through the type system: a holiday
 * outside its own year, a special cabinet day with no resolution behind it, or a count so
 * far off that the scrape must have half-failed.
 */
export function validateYear(year: HolidayYear): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const holiday of year.holidays) {
    if (!holiday.date.startsWith(`${year.year}-`)) {
      errors.push(`${holiday.date} is not inside year ${year.year}.`);
    }
    if (seen.has(holiday.date)) {
      errors.push(`Duplicate entry for ${holiday.date}.`);
    }
    seen.add(holiday.date);

    if (holiday.date_be.slice(5) !== holiday.date.slice(5)) {
      errors.push(`${holiday.date}: Buddhist date ${holiday.date_be} does not match.`);
    }

    // A future cabinet holiday with no citation is unsafe to publish as settled: nothing
    // shows it was actually granted. For a year already under way the day is a matter of
    // record, and a missing citation is only a gap in the sourcing.
    if (
      holiday.type === 'special_cabinet' &&
      holiday.status === 'confirmed' &&
      !holiday.cabinet_resolution &&
      year.year > new Date().getUTCFullYear()
    ) {
      errors.push(
        `${holiday.date} is a confirmed special cabinet holiday in a future year but cites ` +
          `no มติ ครม. Confirming one without a resolution defeats the point of the field.`,
      );
    }

    if (holiday.type === 'substitution') {
      if (!holiday.substitutes_for) {
        // A relocated day off need not point at a weekend, but something has to explain it.
        if (!holiday.cabinet_resolution) {
          errors.push(
            `${holiday.date} is a substitution but names neither a holiday it compensates ` +
              `nor a มติ ครม. that relocated it.`,
          );
        }
      } else if (!isWeekend(holiday.substitutes_for.date)) {
        errors.push(
          `${holiday.date} compensates ${holiday.substitutes_for.date}, which is not a weekend.`,
        );
      }
    }

    if (holiday.confirmed_by.length === 0) {
      errors.push(`${holiday.date} lists no source.`);
    }
  }

  const daysOff = year.holidays.filter((h) => h.is_day_off).length;
  if (daysOff < 12 || daysOff > 30) {
    errors.push(`${year.year_be} has ${daysOff} days off, outside the plausible range of 12-30.`);
  }

  const anyProvisional = year.holidays.some((h) => h.status === 'provisional');
  if (anyProvisional && year.status !== 'provisional') {
    errors.push(`${year.year_be} contains provisional holidays but is marked confirmed.`);
  }

  return errors;
}

export function validateParsed(raw: unknown): { year: HolidayYear | null; errors: string[] } {
  const parsed = HolidayYear.safeParse(raw);
  if (!parsed.success) {
    return { year: null, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  return { year: parsed.data, errors: validateYear(parsed.data) };
}
