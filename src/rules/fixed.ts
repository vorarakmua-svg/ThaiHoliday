import type { SourceRecord } from '../schema.js';
import { ceYear, iso, isWeekend } from './dates.js';

interface FixedHoliday {
  month: number;
  day: number;
  name_th: string;
  /** First Buddhist year this holiday applied, inclusive. */
  fromBe?: number;
  /** Last Buddhist year this holiday applied, inclusive. */
  untilBe?: number;
}

/**
 * Government holidays that fall on a fixed Gregorian date every year. These are
 * computed rather than scraped, so a source outage cannot lose them.
 *
 * Deliberately excludes วันแรงงานแห่งชาติ (1 May): it is a holiday for the private
 * sector and financial institutions, not for government offices.
 *
 * Lunar days (มาฆบูชา, วิสาขบูชา, อาสาฬหบูชา, เข้าพรรษา) and วันพืชมงคล are absent by
 * design — they move each year and must come from a source.
 */
const FIXED: FixedHoliday[] = [
  { month: 1, day: 1, name_th: 'วันขึ้นปีใหม่' },
  { month: 4, day: 6, name_th: 'วันจักรี' },
  { month: 4, day: 13, name_th: 'วันสงกรานต์' },
  { month: 4, day: 14, name_th: 'วันสงกรานต์' },
  { month: 4, day: 15, name_th: 'วันสงกรานต์' },
  { month: 5, day: 4, name_th: 'วันฉัตรมงคล', fromBe: 2562 },
  { month: 6, day: 3, name_th: 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี', fromBe: 2562 },
  { month: 7, day: 28, name_th: 'วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระวชิรเกล้าเจ้าอยู่หัว', fromBe: 2560 },
  { month: 8, day: 12, name_th: 'วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าสิริกิติ์ พระบรมราชินีนาถ พระบรมราชชนนีพันปีหลวง' },
  { month: 10, day: 13, name_th: 'วันนวมินทรมหาราช', fromBe: 2560 },
  { month: 10, day: 23, name_th: 'วันปิยมหาราช' },
  { month: 12, day: 5, name_th: 'วันคล้ายวันพระบรมราชสมภพพระบาทสมเด็จพระบรมชนกาธิเบศร มหาภูมิพลอดุลยเดชมหาราช บรมนาถบพิตร' },
  { month: 12, day: 10, name_th: 'วันรัฐธรรมนูญ' },
  { month: 12, day: 31, name_th: 'วันสิ้นปี' },
];

/** The fixed statutory holidays that applied in a given Buddhist year. */
export function fixedHolidays(yearBe: number): SourceRecord[] {
  const yearCe = ceYear(yearBe);
  return FIXED.filter(
    (h) => (h.fromBe === undefined || yearBe >= h.fromBe) && (h.untilBe === undefined || yearBe <= h.untilBe),
  ).map((h) => {
    const date = iso(yearCe, h.month, h.day);
    return {
      source: 'rules' as const,
      date,
      name_th: h.name_th,
      type: 'public' as const,
      // A statutory holiday landing on a weekend is not itself a day off; the day off
      // becomes a separate substitution entry.
      is_day_off: !isWeekend(date),
    };
  });
}
