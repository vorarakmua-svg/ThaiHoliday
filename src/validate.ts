import { HolidayYear } from './schema.js';
import { lunarDates, type LunarHoliday } from './rules/lunar.js';
import { beYear, currentYearCe, dayOfWeek, isValidIsoDate, isWeekend, toBuddhistIso } from './rules/dates.js';

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

  if (year.year_be !== beYear(year.year)) {
    errors.push(`year_be ${year.year_be} does not correspond to year ${year.year}.`);
  }

  const lunar = lunarDates(year.year);

  for (const holiday of year.holidays) {
    if (!holiday.date.startsWith(`${year.year}-`)) {
      errors.push(`${holiday.date} is not inside year ${year.year}.`);
    }
    if (seen.has(holiday.date)) {
      errors.push(`Duplicate entry for ${holiday.date}.`);
    }
    seen.add(holiday.date);

    // The schema only checks the shape. A hand-edited "2026-02-30" or a day name copied
    // from the wrong row would otherwise be published as-is.
    if (!isValidIsoDate(holiday.date)) {
      errors.push(`${holiday.date} is not a real calendar date.`);
      continue;
    }
    if (holiday.date_be !== toBuddhistIso(holiday.date)) {
      errors.push(`${holiday.date}: Buddhist date ${holiday.date_be} does not match.`);
    }
    if (holiday.day_of_week !== dayOfWeek(holiday.date)) {
      errors.push(
        `${holiday.date} is a ${dayOfWeek(holiday.date)}, but day_of_week says ${holiday.day_of_week}.`,
      );
    }

    // A future cabinet holiday with no citation is unsafe to publish as settled: nothing
    // shows it was actually granted. For a year already under way the day is a matter of
    // record, and a missing citation is only a gap in the sourcing.
    if (
      holiday.type === 'special_cabinet' &&
      holiday.status === 'confirmed' &&
      !holiday.cabinet_resolution &&
      year.year > currentYearCe()
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

    // The Buddhist holidays are fixed points of the lunar calendar. A date that disagrees
    // with it is far more likely a misread page than a real change; an override is the
    // escape hatch if ครม. ever does move one.
    const computed = lunar?.[holiday.key as LunarHoliday];
    if (computed && computed !== holiday.date && !holiday.confirmed_by.includes('override')) {
      errors.push(
        `${holiday.date} is listed as ${holiday.key}, but the lunar calendar puts it on ${computed}.`,
      );
    }

    // Consumers are told to match on `key`. A name no rule recognises gets "unknown" and
    // its Thai text as the English name, which is no key at all. Teach src/rules/names.ts
    // the name, or correct name_th through an override, before publishing.
    if (holiday.key === 'unknown') {
      errors.push(`${holiday.date} has no recognised key (name "${holiday.name_th}").`);
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
  if (!anyProvisional && year.status === 'provisional') {
    errors.push(`${year.year_be} is marked provisional but every holiday in it is confirmed.`);
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
