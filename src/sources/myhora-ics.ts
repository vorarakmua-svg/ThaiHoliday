import type { SourceResult } from '../schema.js';
import { fetchText } from '../http.js';
import { ceYear } from '../rules/dates.js';
import { normaliseThai, resolveName } from '../rules/names.js';
import { parseIcs } from './ics.js';

export const MYHORA_ICS_SOURCE = 'myhora-ics' as const;

export const MYHORA_ICS_URL = 'https://www.myhora.com/calendar/ical/holiday.aspx';

/**
 * MyHora's iCalendar feed, used as a cross-check on its own HTML page.
 *
 * The feed always returns the current Buddhist year regardless of any query parameter
 * (`?year=`, `?y=` and `?yr=` are all ignored), so it can corroborate this year only.
 * Requests for any other year yield no records rather than wrong ones.
 */
export function parseMyhoraIcs(raw: string, yearBe: number): SourceResult {
  const yearCe = ceYear(yearBe);
  const events = parseIcs(raw);
  const warnings: string[] = [];

  const records = events
    .filter((event) => event.date.startsWith(`${yearCe}-`))
    .map((event) => {
      const name_th = normaliseThai(event.summary);
      const resolved = resolveName(name_th);
      return {
        source: MYHORA_ICS_SOURCE,
        date: event.date,
        name_th,
        type: resolved.type,
      };
    });

  if (events.length > 0 && records.length === 0) {
    warnings.push(
      `MyHora's iCalendar feed covers a different year than ${yearBe}; it only ever serves the current year.`,
    );
  }

  return { source: MYHORA_ICS_SOURCE, url: MYHORA_ICS_URL, records, warnings };
}

export async function fetchMyhoraIcs(yearBe: number): Promise<SourceResult> {
  return parseMyhoraIcs(await fetchText(MYHORA_ICS_URL), yearBe);
}
