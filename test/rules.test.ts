import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  expandBuddhistYear,
  isWeekend,
  monthFromThaiAbbr,
  monthFromThaiFull,
  toBuddhistIso,
} from '../src/rules/dates.js';
import { resolveName } from '../src/rules/names.js';
import { computeSubstitutions } from '../src/rules/substitution.js';
import { fixedHolidays } from '../src/rules/fixed.js';

describe('date helpers', () => {
  it('expands abbreviated Buddhist years as MyHora writes them', () => {
    expect(expandBuddhistYear('69')).toBe(2569);
    expect(expandBuddhistYear('2569')).toBe(2569);
  });

  it('tolerates the stray space in the 2568 remark ("11 ส.ค .2568")', () => {
    expect(monthFromThaiAbbr('ส.ค .')).toBe(8);
    expect(monthFromThaiAbbr('ส.ค.')).toBe(8);
    expect(monthFromThaiAbbr('ธ.ค.')).toBe(12);
    expect(monthFromThaiAbbr('ไม่ใช่เดือน')).toBeNull();
  });

  it('maps full Thai month names from calendar rows', () => {
    expect(monthFromThaiFull('มกราคม')).toBe(1);
    expect(monthFromThaiFull('ธันวาคม')).toBe(12);
  });

  it('computes weekdays in UTC, independent of the local timezone', () => {
    expect(dayOfWeek('2026-01-01')).toBe('thursday');
    expect(dayOfWeek('2026-05-31')).toBe('sunday');
    expect(dayOfWeek('2026-12-05')).toBe('saturday');
    expect(isWeekend('2026-05-31')).toBe(true);
    expect(isWeekend('2026-06-01')).toBe(false);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('converts to Buddhist Era', () => {
    expect(toBuddhistIso('2026-01-02')).toBe('2569-01-02');
  });
});

describe('name resolution', () => {
  it('matches substitution before the observance it embeds', () => {
    // Google names substitutions this way; matching วิสาขบูชา first would mislabel it.
    expect(resolveName('วันหยุดชดเชยวันวิสาขบูชา').key).toBe('substitution_holiday');
    expect(resolveName('วันหยุดชดเชย').type).toBe('substitution');
  });

  it('distinguishes the Queen Mother (12 Aug) from Queen Suthida (3 Jun)', () => {
    // The Queen Mother's full title contains "พระบรมราชินีนาถ", which also matches
    // the shorter "พระบรมราชินี" used for Queen Suthida.
    expect(resolveName('วันแม่').key).toBe('queen_mother_birthday');
    expect(
      resolveName('วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าสิริกิติ์ พระบรมราชินีนาถ พระบรมราชชนนีพันปีหลวง').key,
    ).toBe('queen_mother_birthday');
    expect(resolveName('วันเฉลิมฯ พระบรมราชินี').key).toBe('queen_suthida_birthday');
  });

  it('distinguishes King Bhumibol memorial (13 Oct) from his birthday (5 Dec)', () => {
    expect(resolveName('วันนวมินทรมหาราช').key).toBe('king_bhumibol_memorial_day');
    expect(
      resolveName('วันคล้ายวันสวรรคตของพระบาทสมเด็จพระปรมินทรมหาภูมิพลอดุลยเดชบรมนาถบพิตร').key,
    ).toBe('king_bhumibol_memorial_day');
    expect(resolveName('วันพ่อ').key).toBe('king_bhumibol_birthday');
  });

  it('recognises cabinet special holidays', () => {
    const m = resolveName('วันหยุดพิเศษ (ครม.)');
    expect(m.key).toBe('special_cabinet_holiday');
    expect(m.type).toBe('special_cabinet');
  });

  it('strips the zero-width space Google injects', () => {
    expect(resolveName('​วันรัฐธรรมนูญ').key).toBe('constitution_day');
  });

  it('accepts Google’s misspelling of New Year’s Day', () => {
    expect(resolveName('วันขื้นปีใหม่').key).toBe('new_year_day');
  });

  it('flags unknown names instead of guessing', () => {
    const m = resolveName('วันที่ไม่มีอยู่จริง');
    expect(m.matched).toBe(false);
    expect(m.key).toBe('unknown');
  });
});

describe('substitution rule', () => {
  it('moves a Sunday observance to Monday (วันวิสาขบูชา 2569)', () => {
    const subs = computeSubstitutions([{ date: '2026-05-31', name_th: 'วันวิสาขบูชา' }]);
    expect(subs).toEqual([
      { date: '2026-06-01', substitutes_for: { date: '2026-05-31', name_th: 'วันวิสาขบูชา' } },
    ]);
  });

  it('skips the weekend after a Saturday observance (วันพ่อ 2569)', () => {
    const subs = computeSubstitutions([{ date: '2026-12-05', name_th: 'วันพ่อ' }]);
    expect(subs[0]!.date).toBe('2026-12-07');
  });

  it('rolls a Saturday/Sunday pair onto consecutive weekdays without colliding', () => {
    // Songkran 2567: 13 Apr Sat, 14 Apr Sun, 15 Apr Mon.
    const subs = computeSubstitutions([
      { date: '2024-04-13', name_th: 'วันสงกรานต์' },
      { date: '2024-04-14', name_th: 'วันสงกรานต์' },
      { date: '2024-04-15', name_th: 'วันสงกรานต์' },
    ]);
    expect(subs.map((s) => s.date)).toEqual(['2024-04-16', '2024-04-17']);
  });

  it('leaves weekday observances alone', () => {
    expect(computeSubstitutions([{ date: '2026-01-01', name_th: 'วันขึ้นปีใหม่' }])).toEqual([]);
  });
});

describe('fixed statutory holidays', () => {
  it('excludes วันแรงงาน, which is not a government holiday', () => {
    const names = fixedHolidays(2569).map((h) => h.name_th);
    expect(names.some((n) => n.includes('แรงงาน'))).toBe(false);
  });

  it('omits lunar days, which cannot be computed', () => {
    const names = fixedHolidays(2569).map((h) => h.name_th).join(' ');
    expect(names).not.toContain('วิสาขบูชา');
    expect(names).not.toContain('มาฆบูชา');
  });

  it('respects effective-from years when backfilling', () => {
    // Queen Suthida's birthday became a holiday in 2562.
    expect(fixedHolidays(2561).some((h) => h.date.endsWith('-06-03'))).toBe(false);
    expect(fixedHolidays(2562).some((h) => h.date.endsWith('-06-03'))).toBe(true);
  });

  it('yields 14 days for a current year', () => {
    expect(fixedHolidays(2569)).toHaveLength(14);
  });
});
