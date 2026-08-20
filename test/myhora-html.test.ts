import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCabinetNotes, parseMyhoraHtml } from '../src/sources/myhora-html.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const parsed = {
  2567: parseMyhoraHtml(fixture('myhora-2567.html'), 2567),
  2568: parseMyhoraHtml(fixture('myhora-2568.html'), 2568),
  2569: parseMyhoraHtml(fixture('myhora-2569.html'), 2569),
  2570: parseMyhoraHtml(fixture('myhora-2570.html'), 2570),
};

const on = (year: keyof typeof parsed, date: string) =>
  parsed[year].records.find((record) => record.date === date);

describe('MyHora calendar rows', () => {
  it('reads the ราชการ column, not the ธนาคาร one', () => {
    // วันแรงงาน is a holiday for banks and the private sector but a working day for
    // government offices. Google's feed gets this wrong; the ราชการ column gets it right.
    expect(on(2569, '2026-05-01')?.is_day_off).toBe(false);
    expect(on(2569, '2026-05-04')?.is_day_off).toBe(true);
  });

  it('includes วันเข้าพรรษา, which Google’s feed omits entirely', () => {
    const khaoPhansa = on(2569, '2026-07-30');
    expect(khaoPhansa?.name_th).toBe('วันเข้าพรรษา');
    expect(khaoPhansa?.is_day_off).toBe(true);
  });

  it('keeps weekend observances as non-days-off', () => {
    // 31 พ.ค. 2569 is a Sunday, so the day off is the substitution on 1 มิ.ย. instead.
    expect(on(2569, '2026-05-31')?.is_day_off).toBe(false);
    expect(on(2569, '2026-06-01')?.is_day_off).toBe(true);
  });

  it('pairs each substitution with the weekend observance it compensates', () => {
    expect(on(2569, '2026-06-01')?.substitutes_for).toEqual({
      date: '2026-05-31',
      name_th: 'วันวิสาขบูชา',
    });
    expect(on(2569, '2026-12-07')?.substitutes_for).toEqual({
      date: '2026-12-05',
      name_th: 'วันพ่อ',
    });
  });

  it('does not let วันแรงงาน steal a substitution pairing', () => {
    // Regression: วันแรงงาน is a non-day-off on a weekday, so it must never enter the
    // queue of observances awaiting compensation.
    for (const record of parsed[2569].records) {
      expect(record.substitutes_for?.name_th).not.toBe('วันแรงงาน');
    }
  });

  it('skips bank-only rows that carry no label', () => {
    // 3 พ.ค. 2570 is a bank substitution with an empty name cell.
    expect(on(2570, '2027-05-03')).toBeUndefined();
  });

  it('recognises every holiday name in every fixture year', () => {
    for (const [year, result] of Object.entries(parsed)) {
      const unrecognised = result.warnings.filter((w) => w.startsWith('Unrecognised'));
      expect(unrecognised, `${year} had unrecognised names`).toEqual([]);
    }
  });
});

describe('มติ ครม. notes', () => {
  it('attaches the resolution to a special holiday the table already lists', () => {
    const newYearExtra = on(2569, '2026-01-02');
    expect(newYearExtra?.type).toBe('special_cabinet');
    expect(newYearExtra?.cabinet_resolution?.date).toBe('2024-11-12');
    expect(newYearExtra?.cabinet_resolution?.text).toContain('2 ม.ค. 69');
  });

  it('recovers a special holiday the calendar table is missing', () => {
    // The 19 พ.ค. 2569 resolution grants 16 ต.ค. 2569, but MyHora's table has no row
    // for that date. Reading only the table would silently drop a real day off.
    const october = on(2569, '2026-10-16');
    expect(october?.type).toBe('special_cabinet');
    expect(october?.is_day_off).toBe(true);
    expect(october?.cabinet_resolution?.date).toBe('2026-05-19');
    expect(parsed[2569].warnings.some((w) => w.includes('2026-10-16'))).toBe(true);
  });

  it('ignores work-from-home days listed alongside a granted holiday', () => {
    // The same resolution lists WFH on 12, 14-15 ต.ค. Those are not days off.
    for (const date of ['2026-10-12', '2026-10-14', '2026-10-15']) {
      expect(on(2569, date)).toBeUndefined();
    }
  });

  it('reads both dates from one resolution, despite a malformed abbreviation', () => {
    // The 2568 note reads "คือ 2 มิ.ย. 2568 และ  11 ส.ค .2568" — note the stray space.
    expect(on(2568, '2025-06-02')?.type).toBe('special_cabinet');
    expect(on(2568, '2025-08-11')?.type).toBe('special_cabinet');
  });

  it('separates two resolutions packed into a single line', () => {
    const kinds = parsed[2567].actions.map((a) => `${a.kind}:${a.resolution.date}`);
    expect(kinds).toEqual(['move:2023-10-25', 'add:2023-10-25', 'add:2024-02-13']);
  });

  it('applies a เลื่อน by removing the date the holiday moved away from', () => {
    // "เลื่อนวันหยุดชดเชยวันสิ้นปี 2566 จาก 2 ม.ค. 2567 เป็น 29 ธ.ค. 2566"
    expect(on(2567, '2024-01-02')).toBeUndefined();
    expect(parsed[2567].warnings.some((w) => w.includes('2024-01-02'))).toBe(true);
  });

  it('warns rather than guessing when a note cannot be parsed', () => {
    const { actions, warnings } = parseCabinetNotes([
      'มติ ครม. 1 ม.ค. 2569 ทำอะไรบางอย่างที่ไม่รู้จัก',
    ]);
    expect(actions).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('ignores remark lines that are not cabinet resolutions', () => {
    expect(parseCabinetNotes(['ปฏิทินจันทรคติไทย พ.ศ.2570 ข้างต้น'])).toEqual({
      actions: [],
      warnings: [],
    });
  });
});

describe('provisional detection', () => {
  it('marks next year provisional while MyHora still calls it unverified', () => {
    expect(parsed[2570].provisional).toBe(true);
    expect(parsed[2570].records.some((r) => r.type === 'special_cabinet')).toBe(false);
  });

  it('treats years with cabinet resolutions as settled', () => {
    expect(parsed[2569].provisional).toBe(false);
    expect(parsed[2568].provisional).toBe(false);
  });
});
