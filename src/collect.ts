import type { HolidayYear, SourceResult } from './schema.js';
import { buildYear } from './merge.js';
import { loadOverride } from './overrides.js';
import { fixedHolidays } from './rules/fixed.js';
import { fetchMyhoraHtml, MYHORA_SOURCE } from './sources/myhora-html.js';
import { fetchMyhoraIcs } from './sources/myhora-ics.js';
import { fetchGoogleIcs } from './sources/google-ics.js';
import { fetchBotHtml } from './sources/bot-html.js';

/**
 * Secondary sources are best-effort. If one is down the year is still publishable from
 * MyHora's page plus the computed rules, so a failure is recorded as a warning rather
 * than aborting the run.
 */
async function optional(
  label: string,
  load: () => Promise<SourceResult>,
): Promise<{ result: SourceResult | null; warning: string | null }> {
  try {
    return { result: await load(), warning: null };
  } catch (error) {
    return {
      result: null,
      warning: `Source ${label} was unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface CollectOptions {
  overridesRoot?: string;
  frozen?: boolean;
  now?: () => string;
}

/**
 * Gather every source for one Buddhist year and merge them into a publishable record.
 *
 * MyHora's HTML page is the only source that is allowed to fail loudly: it is the primary,
 * and a year built without it would be missing the lunar dates, วันพืชมงคล and every
 * มติ ครม. note.
 */
export async function collectYear(
  yearBe: number,
  options: CollectOptions = {},
): Promise<HolidayYear> {
  const { overridesRoot, frozen = false, now = () => new Date().toISOString() } = options;

  const primary = await fetchMyhoraHtml(yearBe);
  const sources: SourceResult[] = [primary];
  const warnings: string[] = [];

  for (const [label, load] of [
    ['myhora-ics', () => fetchMyhoraIcs(yearBe)],
    ['bot-html', () => fetchBotHtml(yearBe)],
    ['google-ics', () => fetchGoogleIcs(yearBe)],
  ] as const) {
    const { result, warning } = await optional(label, load);
    if (result) sources.push(result);
    if (warning) warnings.push(warning);
  }

  // The computed rules normally only corroborate. A statutory date missing from MyHora is
  // far more often a cabinet cancellation than a scrape failure, and reinstating it would
  // publish a day that government offices are actually open.
  //
  // They are promoted to a real source only when the primary returned nothing at all,
  // which means the page itself failed rather than the calendar having changed.
  const primaryFailed = primary.records.length === 0;
  sources.push({
    source: 'rules',
    url: 'computed from statute — see src/rules/fixed.ts',
    records: fixedHolidays(yearBe),
    warnings: primaryFailed
      ? ['MyHora returned no rows, so the year was rebuilt from statutory rules alone. ' +
         'Lunar dates, วันพืชมงคล and every มติ ครม. are missing. Do not merge this.']
      : [],
    corroborateOnly: !primaryFailed,
  });

  const year = buildYear(
    {
      yearBe,
      sources,
      provisional: primary.provisional,
      override: loadOverride(yearBe, overridesRoot),
    },
    now(),
    frozen,
  );

  year.warnings.unshift(...warnings);
  return year;
}

export { MYHORA_SOURCE };
