import type {
  Holiday,
  HolidayStatus,
  HolidayType,
  SourceId,
  SourceRecord,
  SourceResult,
} from './schema.js';
import type { OverrideFile } from './overrides.js';
import { beYear, ceYear, dayOfWeek, isWeekend, toBuddhistIso } from './rules/dates.js';
import { resolveName } from './rules/names.js';

/**
 * Highest authority first.
 *
 * MyHora's HTML page outranks its own iCalendar feed because only the page carries the
 * มติ ครม. notes. The computed rules sit below both sources but above Google, so a scrape
 * that loses a fixed statutory date still publishes it.
 */
const PRECEDENCE: SourceId[] = [
  'override',
  'myhora-html',
  'myhora-ics',
  'rules',
  'lunar-calendar',
  'google-ics',
];

/**
 * Sources that may only corroborate a date another source already found.
 *
 * Google's feed carries mislabelled and misspelled names and omits real holidays, so
 * letting it introduce a day would publish Google's mistakes as Thai government policy.
 *
 * BOT publishes the financial-institution calendar, which is not the government one. It
 * grants bank-only days, scopes some grants to Bangkok, and does not follow every
 * government day off. A day it introduced would be a bank holiday presented as a
 * วันหยุดราชการ, so it can confirm a date but never add one.
 */
const CORROBORATION_ONLY: ReadonlySet<SourceId> = new Set<SourceId>(['google-ics', 'bot-html']);

function rank(source: SourceId): number {
  const index = PRECEDENCE.indexOf(source);
  return index === -1 ? PRECEDENCE.length : index;
}

/**
 * A corroborating source reported a date nobody authoritative has. For the computed rules
 * that is the interesting case: a statutory holiday absent from every source has usually
 * been cancelled or moved by ครม., not lost in a bad scrape. Reinstating it automatically
 * would have published Songkran 2563 as a holiday during the COVID postponement.
 */
function unreportedDateWarning(source: SourceId, date: string, name: string): string {
  if (source === 'rules') {
    return (
      `${date} (${name}) is a fixed statutory holiday, but no source lists it. Either ครม. ` +
      `cancelled or moved it, or the scrape is incomplete. It has been left out — add it ` +
      `through data/overrides if it should be there.`
    );
  }
  if (source === 'lunar-calendar') {
    return (
      `The lunar calendar puts ${name} on ${date}, but no source lists that date. Check ` +
        `whether MyHora has it on another day, or whether it shares a date with another holiday.`
    );
  }
  return (
    `${source} lists a holiday on ${date} ("${name}") that no authoritative source reports. ` +
    `Check whether it is a real day off before merging.`
  );
}

interface Candidate {
  date: string;
  name_th: string;
  type: HolidayType;
  is_day_off: boolean;
  substitutes_for: Holiday['substitutes_for'];
  cabinet_resolution: Holiday['cabinet_resolution'];
  confirmed_by: SourceId[];
  /** Set only by an override; otherwise derived from the name and the year. */
  name_en?: string;
  status?: HolidayStatus;
  /** Rank of the best source that has supplied each field so far. */
  nameRank: number;
  typeRank: number;
  dayOffRank: number;
}

export interface MergeInput {
  yearBe: number;
  sources: SourceResult[];
  override?: OverrideFile | null;
  /** Set when a source reports the year is not yet ratified. */
  provisional?: boolean;
}

export interface MergeResult {
  holidays: Holiday[];
  warnings: string[];
  status: HolidayStatus;
  sourceUrls: string[];
}

function applyRecord(candidate: Candidate, record: SourceRecord): void {
  const r = rank(record.source);
  if (!candidate.confirmed_by.includes(record.source)) candidate.confirmed_by.push(record.source);

  if (record.name_th && r < candidate.nameRank) {
    candidate.name_th = record.name_th;
    candidate.nameRank = r;
  }
  if (record.type && r < candidate.typeRank) {
    candidate.type = record.type;
    candidate.typeRank = r;
  }
  if (record.is_day_off !== undefined && r < candidate.dayOffRank) {
    candidate.is_day_off = record.is_day_off;
    candidate.dayOffRank = r;
  }
  if (record.substitutes_for) candidate.substitutes_for ??= record.substitutes_for;
  // A cabinet resolution is only ever added by a source, never removed by a lower one.
  if (record.cabinet_resolution) candidate.cabinet_resolution ??= record.cabinet_resolution;
}

export function mergeYear(input: MergeInput): MergeResult {
  const { yearBe, sources, override } = input;
  const yearCe = ceYear(yearBe);
  const warnings: string[] = [];
  const candidates = new Map<string, Candidate>();

  const ordered = [...sources].sort((a, b) => rank(a.source) - rank(b.source));

  for (const source of ordered) {
    warnings.push(...source.warnings);
    const mayIntroduce = !CORROBORATION_ONLY.has(source.source) && source.corroborateOnly !== true;

    for (const record of source.records) {
      if (!record.date.startsWith(`${yearCe}-`)) continue;

      const existing = candidates.get(record.date);
      if (existing) {
        applyRecord(existing, record);
        continue;
      }

      if (!mayIntroduce) {
        warnings.push(unreportedDateWarning(record.source, record.date, record.name_th));
        continue;
      }

      const candidate: Candidate = {
        date: record.date,
        name_th: record.name_th,
        type: record.type ?? 'public',
        is_day_off: record.is_day_off ?? true,
        substitutes_for: record.substitutes_for ?? null,
        cabinet_resolution: record.cabinet_resolution ?? null,
        confirmed_by: [record.source],
        nameRank: rank(record.source),
        typeRank: record.type ? rank(record.source) : PRECEDENCE.length,
        dayOffRank: record.is_day_off !== undefined ? rank(record.source) : PRECEDENCE.length,
      };
      candidates.set(record.date, candidate);
    }
  }

  applyOverride(candidates, override, yearCe, warnings);

  const holidays: Holiday[] = [...candidates.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((candidate) => {
      const resolved = resolveName(candidate.name_th);
      const type = candidate.typeRank < PRECEDENCE.length ? candidate.type : resolved.type;
      return {
        date: candidate.date,
        date_be: toBuddhistIso(candidate.date),
        day_of_week: dayOfWeek(candidate.date),
        key: resolved.key,
        name_th: candidate.name_th,
        name_en: candidate.name_en ?? resolved.name_en,
        type,
        status: candidate.status ?? holidayStatus(type, candidate, input.provisional === true),
        is_day_off: candidate.is_day_off,
        substitutes_for: candidate.substitutes_for,
        cabinet_resolution: candidate.cabinet_resolution,
        confirmed_by: [...candidate.confirmed_by].sort((a, b) => rank(a) - rank(b)),
      };
    });

  warnings.push(...crossCheck(holidays));

  return {
    holidays,
    warnings,
    status: holidays.some((h) => h.status === 'provisional') ? 'provisional' : 'confirmed',
    sourceUrls: ordered.map((s) => s.url),
  };
}

/**
 * `provisional` means the calendar can still change — the year has not been ratified.
 *
 * It is deliberately not used to mean "we could not find the citation". A holiday that
 * already happened is a matter of record whether or not MyHora printed the resolution
 * behind it, and marking a past day off as provisional would tell consumers to doubt
 * something certain. A missing citation is reported as a warning instead.
 *
 * Within an unratified year, fixed statutory dates stay confirmed because they do not
 * depend on ครม.; everything that moves — lunar days, royal proclamations, and the
 * substitutions derived from them — is provisional.
 */
function holidayStatus(
  _type: HolidayType,
  candidate: Candidate,
  yearIsProvisional: boolean,
): HolidayStatus {
  if (!yearIsProvisional) return 'confirmed';
  const isFixedStatutory = candidate.confirmed_by.includes('rules');
  return isFixedStatutory ? 'confirmed' : 'provisional';
}

function applyOverride(
  candidates: Map<string, Candidate>,
  override: OverrideFile | null | undefined,
  yearCe: number,
  warnings: string[],
): void {
  if (!override) return;

  for (const entry of override.remove ?? []) {
    if (!candidates.delete(entry.date)) {
      warnings.push(`Override removes ${entry.date}, but no source reported it. Stale override?`);
    }
  }

  for (const entry of override.add ?? []) {
    if (!entry.date.startsWith(`${yearCe}-`)) {
      warnings.push(`Override adds ${entry.date}, which is outside ${yearCe}. Ignored.`);
      continue;
    }
    const existing = candidates.get(entry.date);
    const target: Candidate = existing ?? {
      date: entry.date,
      name_th: entry.name_th ?? 'วันหยุดพิเศษ (ครม.)',
      type: entry.type ?? 'special_cabinet',
      is_day_off: entry.is_day_off ?? true,
      substitutes_for: null,
      cabinet_resolution: null,
      confirmed_by: [],
      nameRank: rank('override'),
      typeRank: rank('override'),
      dayOffRank: rank('override'),
    };

    if (entry.name_th) {
      target.name_th = entry.name_th;
      target.nameRank = rank('override');
    }
    if (entry.type) {
      target.type = entry.type;
      target.typeRank = rank('override');
    }
    if (entry.is_day_off !== undefined) {
      target.is_day_off = entry.is_day_off;
      target.dayOffRank = rank('override');
    }
    if (entry.name_en) target.name_en = entry.name_en;
    if (entry.status) target.status = entry.status;
    if (entry.cabinet_resolution !== undefined) target.cabinet_resolution = entry.cabinet_resolution;
    if (!target.confirmed_by.includes('override')) target.confirmed_by.unshift('override');

    candidates.set(entry.date, target);
  }
}

/** Checks that need the whole merged year in view. */
function crossCheck(holidays: Holiday[]): string[] {
  const warnings: string[] = [];
  const byDate = new Map(holidays.map((h) => [h.date, h]));

  for (const holiday of holidays) {
    if (holiday.type === 'substitution') {
      const target = holiday.substitutes_for;
      if (!target) {
        // ครม. sometimes relocates a day off without tying it to a weekend at all, as it
        // did repeatedly through 2563. That is legitimate as long as a resolution says so.
        if (!holiday.cabinet_resolution) {
          warnings.push(`Substitution on ${holiday.date} does not say what it compensates.`);
        }
      } else if (!isWeekend(target.date)) {
        warnings.push(
          `Substitution on ${holiday.date} claims to compensate ${target.date}, which is a ` +
            `weekday. Substitutions only apply to weekend holidays.`,
        );
      } else if (!byDate.has(target.date) && target.date.startsWith(`${holiday.date.slice(0, 4)}-`)) {
        // A target in the previous year is expected for New Year substitutions.
        warnings.push(
          `Substitution on ${holiday.date} compensates ${target.date}, which is not in the year.`,
        );
      }
    }

    if (holiday.is_day_off && isWeekend(holiday.date) && holiday.type !== 'special_cabinet') {
      warnings.push(
        `${holiday.date} (${holiday.name_th}) is marked a day off but falls on a ${holiday.day_of_week}.`,
      );
    }

    if (holiday.key === 'unknown') {
      warnings.push(`${holiday.date} has an unrecognised name: "${holiday.name_th}".`);
    }

    if (holiday.type === 'special_cabinet' && !holiday.cabinet_resolution) {
      warnings.push(
        `${holiday.date} (${holiday.name_th}) is a cabinet holiday with no มติ ครม. cited. ` +
          `The day itself is attested; only the citation is missing.`,
      );
    }
  }

  const daysOff = holidays.filter((h) => h.is_day_off).length;
  if (daysOff < 12 || daysOff > 30) {
    warnings.push(
      `${daysOff} government days off is outside the expected range of 12-30. Verify the sources.`,
    );
  }

  return warnings;
}

export function buildYear(input: MergeInput, generatedAt: string, frozen: boolean) {
  const merged = mergeYear(input);
  return {
    year: ceYear(input.yearBe),
    year_be: input.yearBe,
    status: merged.status,
    frozen,
    generated_at: generatedAt,
    source_urls: merged.sourceUrls,
    holidays: merged.holidays,
    warnings: merged.warnings,
  };
}

export { beYear };
