import type { SourceResult } from '../schema.js';
import { fetchText } from '../http.js';
import { ceYear } from '../rules/dates.js';
import { normaliseThai } from '../rules/names.js';
import { parseIcs } from './ics.js';

export const GOOGLE_SOURCE = 'google-ics' as const;

export const GOOGLE_ICS_URL =
  'https://calendar.google.com/calendar/ical/th.th%23holiday%40group.v.calendar.google.com/public/basic.ics';

/**
 * Google's Thai calendar mixes public holidays with observances such as วันวาเลนไทน์ and
 * วันคริสต์มาส. Only entries described as วันหยุดนักขัตฤกษ์ are days off.
 */
const OFFICIAL_HOLIDAY = 'วันหยุดนักขัตฤกษ์';

/**
 * Google's feed corroborates dates and nothing else. Its names are unreliable: cabinet
 * holidays come through as bare "นักขัตฤกษ์" (2 มิ.ย. 2568) or as an outright mislabel
 * ("วันหยุดราชการธันวาคม" for 2 ม.ค. 2569), New Year's Day is misspelled "วันขื้นปีใหม่",
 * and วันเข้าพรรษา is missing altogether. Treat it as a second opinion on which dates
 * exist, never as a source of truth for what they are called.
 */
export function parseGoogleIcs(raw: string, yearBe: number): SourceResult {
  const yearCe = ceYear(yearBe);
  const records = parseIcs(raw)
    .filter((event) => event.description.includes(OFFICIAL_HOLIDAY))
    .filter((event) => event.date.startsWith(`${yearCe}-`))
    .map((event) => ({
      source: GOOGLE_SOURCE,
      date: event.date,
      name_th: normaliseThai(event.summary),
    }));

  const warnings: string[] = [];
  if (records.length === 0) {
    warnings.push(
      `Google's calendar returned no holidays for ${yearBe}. Its feed covers roughly 2021-2030.`,
    );
  }

  return { source: GOOGLE_SOURCE, url: GOOGLE_ICS_URL, records, warnings };
}

export async function fetchGoogleIcs(yearBe: number): Promise<SourceResult> {
  return parseGoogleIcs(await fetchText(GOOGLE_ICS_URL), yearBe);
}
