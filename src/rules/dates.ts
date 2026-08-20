import { BE_OFFSET, type DayOfWeek } from '../schema.js';

const DOW: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** Thai month abbreviations as they appear in มติ ครม. text, in calendar order. */
export const THAI_MONTH_ABBR = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

/** Full Thai month names as they appear in MyHora calendar rows. */
export const THAI_MONTH_FULL = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

/** 1-based month number for a full Thai month name, or null. */
export function monthFromThaiFull(name: string): number | null {
  const i = THAI_MONTH_FULL.indexOf(name.trim() as (typeof THAI_MONTH_FULL)[number]);
  return i === -1 ? null : i + 1;
}

/**
 * 1-based month number for a Thai month abbreviation. Tolerates the stray spaces
 * MyHora sometimes emits, e.g. `ส.ค .` in the 2568 remark.
 */
export function monthFromThaiAbbr(abbr: string): number | null {
  const cleaned = abbr.replace(/\s+/g, '');
  const i = THAI_MONTH_ABBR.indexOf(cleaned as (typeof THAI_MONTH_ABBR)[number]);
  return i === -1 ? null : i + 1;
}

/** Build an ISO date string without touching the local timezone. */
export function iso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Shift an ISO date's year by the BE offset, keeping month and day. */
export function toBuddhistIso(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${Number(y) + BE_OFFSET}-${m}-${d}`;
}

export function ceYear(yearBe: number): number {
  return yearBe - BE_OFFSET;
}

export function beYear(yearCe: number): number {
  return yearCe + BE_OFFSET;
}

/**
 * Expand a two- or four-digit Buddhist year. `69` becomes 2569; `2569` is returned
 * as-is. MyHora abbreviates inconsistently within a single remark.
 */
export function expandBuddhistYear(raw: string): number {
  const n = Number(raw.replace(/\s+/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return n < 100 ? 2500 + n : n;
}

export function dayOfWeek(isoDate: string): DayOfWeek {
  const [y, m, d] = isoDate.split('-').map(Number);
  const idx = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return DOW[idx]!;
}

export function isWeekend(isoDate: string): boolean {
  const dow = dayOfWeek(isoDate);
  return dow === 'saturday' || dow === 'sunday';
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m! < 1 || m! > 12 || d! < 1 || d! > 31) return false;
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}
