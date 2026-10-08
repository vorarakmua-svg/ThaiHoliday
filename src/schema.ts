import { z } from 'zod';

/** Difference between the Buddhist Era and the Common Era. */
export const BE_OFFSET = 543;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const DayOfWeek = z.enum([
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

/**
 * `public`          statutory holiday (วันหยุดราชการ)
 * `substitution`    compensatory day when a holiday lands on a weekend (วันหยุดชดเชย)
 * `special_cabinet` one-off granted by cabinet resolution (วันหยุดพิเศษ ตามมติ ครม.)
 * `royal`           set annually by royal proclamation, e.g. วันพืชมงคล
 */
export const HolidayType = z.enum(['public', 'substitution', 'special_cabinet', 'royal']);

/**
 * `confirmed`   backed by a cited มติ ครม. or a fixed statutory date
 * `provisional` computed or predicted, not yet ratified for this year
 */
export const HolidayStatus = z.enum(['confirmed', 'provisional']);

export const SourceId = z.enum([
  'override',
  'myhora-html',
  'myhora-ics',
  'google-ics',
  'bot-html',
  'rules',
  'lunar-calendar',
]);

export const CabinetResolution = z.object({
  /** Date the cabinet met, ISO (CE). Null when the text cites no parseable date. */
  date: z.string().regex(ISO_DATE).nullable(),
  /** Verbatim Thai text of the resolution, kept for human review. */
  text: z.string().min(1),
});

export const SubstitutesFor = z.object({
  date: z.string().regex(ISO_DATE),
  name_th: z.string().min(1),
});

export const Holiday = z.object({
  /** Gregorian date, ISO. */
  date: z.string().regex(ISO_DATE),
  /** Same day expressed in the Buddhist Era. */
  date_be: z.string().regex(ISO_DATE),
  day_of_week: DayOfWeek,
  /** Stable slug — match on this rather than on Thai text. */
  key: z.string().regex(/^[a-z0-9_]+$/),
  name_th: z.string().min(1),
  name_en: z.string().min(1),
  type: HolidayType,
  status: HolidayStatus,
  /**
   * Whether government offices actually close. False when the observance lands on a
   * weekend — the day off is then a separate `substitution` entry.
   */
  is_day_off: z.boolean(),
  /** For `substitution` entries: the observance being compensated. */
  substitutes_for: SubstitutesFor.nullable(),
  cabinet_resolution: CabinetResolution.nullable(),
  /** Which sources attested this date. */
  confirmed_by: z.array(SourceId).min(1),
});

export const HolidayYear = z.object({
  year: z.number().int(),
  year_be: z.number().int(),
  /** `provisional` if any holiday in the year is provisional. */
  status: HolidayStatus,
  /** Frozen years are never re-scraped and must not change. */
  frozen: z.boolean(),
  generated_at: z.string(),
  source_urls: z.array(z.string()),
  holidays: z.array(Holiday),
  /** Anything a human should look at before merging. */
  warnings: z.array(z.string()),
});

export type DayOfWeek = z.infer<typeof DayOfWeek>;
export type HolidayType = z.infer<typeof HolidayType>;
export type HolidayStatus = z.infer<typeof HolidayStatus>;
export type SourceId = z.infer<typeof SourceId>;
export type CabinetResolution = z.infer<typeof CabinetResolution>;
export type Holiday = z.infer<typeof Holiday>;
export type HolidayYear = z.infer<typeof HolidayYear>;

/** A single holiday as reported by one source, before merging. */
export interface SourceRecord {
  source: SourceId;
  date: string;
  name_th: string;
  /** Undefined when the source does not distinguish government from bank holidays. */
  is_day_off?: boolean;
  type?: HolidayType;
  substitutes_for?: { date: string; name_th: string } | null;
  cabinet_resolution?: CabinetResolution | null;
}

export interface SourceResult {
  source: SourceId;
  url: string;
  records: SourceRecord[];
  warnings: string[];
  /** Set by sources that can tell the year is not yet ratified. */
  provisional?: boolean;
  /**
   * When true this source may confirm a date another source found, but may not introduce
   * one of its own. Used to stop the computed rules from reinstating a holiday that ครม.
   * cancelled — as happened to Songkran in 2563.
   */
  corroborateOnly?: boolean;
}
