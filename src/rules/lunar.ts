import type { SourceRecord } from '../schema.js';
import { addDays, ceYear, isWeekend } from './dates.js';

/**
 * The Thai lunar calendar (ปฏิทินจันทรคติไทย), computed rather than scraped.
 *
 * The four Buddhist holidays are fixed points of this calendar, so given the type of each
 * lunar year their Gregorian dates follow by arithmetic:
 *
 *   ปกติมาส   normal year       12 months, 354 days
 *   อธิกวาร   extra-day year    month 7 gains a day, 355 days
 *   อธิกมาส   extra-month year  a second month 8 (เดือนแปดสองหน), 384 days
 *
 * Months alternate 29 and 30 days, starting with 29. Counting from the start of the lunar
 * year: มาฆบูชา is the full moon of month 3, วิสาขบูชา of month 6, อาสาฬหบูชา of month 8, and
 * เข้าพรรษา the day after. In an อธิกมาส year each moves one month later (month 4, 7 and 8.8).
 *
 * The year types cannot be derived without the full astronomical reckoning, so they are a
 * table. It is the one published with the MIT-licensed python-holidays project
 * (holidays/calendars/thai.py), transcribed there from the 1757-2157 Thai lunar calendar
 * after Ninenik Narkdee's implementation. Checked here against every lunar holiday in
 * data/ for 2560-2570: all 44 dates agree.
 *
 * This gives the lunar days a witness that does not depend on MyHora, and one that CI can
 * consult without touching the network.
 */

/** Gregorian years whose lunar year has an extra month (อธิกมาส). */
const ATHIKAMAT = new Set([
  1915, 1918, 1920, 1923, 1926, 1928, 1931, 1934, 1937, 1939, 1942, 1944, 1947, 1950,
  1953, 1956, 1958, 1961, 1964, 1966, 1969, 1972, 1975, 1977, 1980, 1983, 1985, 1988,
  1991, 1994, 1996, 1999, 2002, 2004, 2007, 2010, 2012, 2015, 2018, 2021, 2023, 2026,
  2029, 2031, 2034, 2037, 2040, 2042, 2045, 2048, 2050, 2053, 2056, 2059, 2062, 2064,
  2066, 2069, 2072, 2074, 2077, 2080, 2082, 2085, 2088, 2091, 2094, 2096, 2099, 2101,
  2104, 2107, 2112, 2114, 2116, 2119, 2122, 2124, 2127, 2130, 2132, 2135, 2138, 2141,
  2144, 2146, 2149, 2151, 2154, 2157
]);

/** Gregorian years whose lunar year has an extra day (อธิกวาร). */
const ATHIKAWAN = new Set([
  1914, 1917, 1925, 1929, 1933, 1936, 1945, 1949, 1952, 1957, 1963, 1970, 1973, 1979,
  1987, 1990, 1997, 2000, 2006, 2009, 2016, 2020, 2025, 2032, 2035, 2043, 2046, 2052,
  2055, 2058, 2067, 2071, 2076, 2083, 2086, 2092, 2097, 2103, 2109, 2111, 2117, 2121,
  2126, 2133, 2136, 2142, 2147, 2153
]);

/** First day of the lunar year that ends in 1914, and the range the table covers. */
const EPOCH = '1913-11-28';
const FIRST_YEAR = 1914;
const LAST_YEAR = 2157;

function lunarYearStart(yearCe: number): string {
  let days = 0;
  for (let y = FIRST_YEAR; y < yearCe; y += 1) {
    days += ATHIKAMAT.has(y) ? 384 : ATHIKAWAN.has(y) ? 355 : 354;
  }
  return addDays(EPOCH, days);
}

export type LunarHoliday = 'makha_bucha' | 'visakha_bucha' | 'asarnha_bucha' | 'khao_phansa';

export const LUNAR_NAMES: Record<LunarHoliday, string> = {
  makha_bucha: 'วันมาฆบูชา',
  visakha_bucha: 'วันวิสาขบูชา',
  asarnha_bucha: 'วันอาสาฬหบูชา',
  khao_phansa: 'วันเข้าพรรษา',
};

/**
 * Gregorian dates of the four lunar holidays in a Gregorian year, or null outside the
 * years the table covers.
 */
export function lunarDates(yearCe: number): Record<LunarHoliday, string> | null {
  if (yearCe < FIRST_YEAR || yearCe > LAST_YEAR) return null;
  const start = lunarYearStart(yearCe);
  const extraMonth = ATHIKAMAT.has(yearCe);
  const extraDay = ATHIKAWAN.has(yearCe);
  // Day offsets from the first day of the year, e.g. มาฆบูชา in a normal year is
  // 29 + 30 + 15 - 1 = 73: the 15th day of month 3.
  const asarnha = extraMonth ? 250 : extraDay ? 221 : 220;
  return {
    makha_bucha: addDays(start, extraMonth ? 102 : 73),
    visakha_bucha: addDays(start, extraMonth ? 191 : 161),
    asarnha_bucha: addDays(start, asarnha),
    khao_phansa: addDays(start, asarnha + 1),
  };
}

/** The lunar holidays of a Buddhist year, as source records. */
export function lunarHolidays(yearBe: number): SourceRecord[] {
  const dates = lunarDates(ceYear(yearBe));
  if (!dates) return [];
  return (Object.keys(dates) as LunarHoliday[]).map((key) => ({
    source: 'lunar-calendar' as const,
    date: dates[key],
    name_th: LUNAR_NAMES[key],
    type: 'public' as const,
    is_day_off: !isWeekend(dates[key]),
  }));
}
