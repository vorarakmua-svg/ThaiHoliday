import { describe, expect, it } from 'vitest';
import { lunarDates, lunarHolidays } from '../src/rules/lunar.js';
import { validateYear } from '../src/validate.js';
import { readYear } from '../src/build.js';

describe('Thai lunar calendar', () => {
  // One year of each type, dates as published by MyHora.
  it('handles a normal year', () => {
    expect(lunarDates(2027)).toEqual({
      makha_bucha: '2027-02-21',
      visakha_bucha: '2027-05-20',
      asarnha_bucha: '2027-07-18',
      khao_phansa: '2027-07-19',
    });
  });

  it('handles an extra-day year (อธิกวาร)', () => {
    expect(lunarDates(2020)).toEqual({
      makha_bucha: '2020-02-08',
      visakha_bucha: '2020-05-06',
      asarnha_bucha: '2020-07-05',
      khao_phansa: '2020-07-06',
    });
  });

  it('handles an extra-month year (เดือนแปดสองหน)', () => {
    expect(lunarDates(2026)).toEqual({
      makha_bucha: '2026-03-03',
      visakha_bucha: '2026-05-31',
      asarnha_bucha: '2026-07-29',
      khao_phansa: '2026-07-30',
    });
  });

  it('agrees with every lunar holiday in the committed data', () => {
    for (let yearBe = 2560; yearBe <= 2570; yearBe += 1) {
      const year = readYear(yearBe)!;
      const computed = lunarDates(year.year)!;
      for (const h of year.holidays) {
        if (h.key in computed) expect(h.date).toBe(computed[h.key as keyof typeof computed]);
      }
    }
  });

  it('says nothing outside the years its table covers', () => {
    expect(lunarDates(1900)).toBeNull();
    expect(lunarDates(2158)).toBeNull();
    expect(lunarHolidays(2701)).toEqual([]);
  });

  it('catches a lunar holiday published on the wrong day', () => {
    const year = readYear(2569)!;
    const shifted = {
      ...year,
      holidays: year.holidays.map((h) =>
        h.key === 'makha_bucha' ? { ...h, date: '2026-03-04', date_be: '2569-03-04', day_of_week: 'wednesday' as const } : h,
      ),
    };
    expect(validateYear(shifted).some((e) => e.includes('lunar calendar puts it on 2026-03-03'))).toBe(true);
  });
});
