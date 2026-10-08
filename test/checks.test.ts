import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateYear } from '../src/validate.js';
import { loadOverride } from '../src/overrides.js';
import { diffYear } from '../src/diff.js';
import { currentYearCe } from '../src/rules/dates.js';
import { parseYearList } from '../src/args.js';
import { HttpStatusError, isRetryable } from '../src/http.js';
import { buildSite, writeYear } from '../src/build.js';
import type { Holiday, HolidayYear } from '../src/schema.js';

const holiday = (h: Partial<Holiday> = {}): Holiday => ({
  date: '2026-01-01',
  date_be: '2569-01-01',
  day_of_week: 'thursday',
  key: 'new_year_day',
  name_th: 'วันขึ้นปีใหม่',
  name_en: "New Year's Day",
  type: 'public',
  status: 'confirmed',
  is_day_off: true,
  substitutes_for: null,
  cabinet_resolution: null,
  confirmed_by: ['myhora-html'],
  ...h,
});

/** Twelve ordinary weekdays off in January, so the day-off count check stays quiet. */
const filler = [5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20].map((day) => {
  const date = `2026-01-${String(day).padStart(2, '0')}`;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
  return holiday({ date, date_be: `2569${date.slice(4)}`, day_of_week: names[dow]! });
});

const year = (holidays: Holiday[], overrides: Partial<HolidayYear> = {}): HolidayYear => ({
  year: 2026,
  year_be: 2569,
  status: 'confirmed',
  frozen: false,
  generated_at: '2026-08-20T00:00:00Z',
  source_urls: [],
  warnings: [],
  holidays: [...holidays, ...filler],
  ...overrides,
});

describe('data validation', () => {
  it('accepts a consistent year', () => {
    expect(validateYear(year([holiday()]))).toEqual([]);
  });

  it('catches a Buddhist date in the wrong year', () => {
    // Only the month and day used to be compared, so 2570-01-01 passed for 2026-01-01.
    expect(validateYear(year([holiday({ date_be: '2570-01-01' })]))).toHaveLength(1);
  });

  it('catches a day of the week that does not match the date', () => {
    expect(validateYear(year([holiday({ day_of_week: 'friday' })]))).toHaveLength(1);
  });

  it('catches a date that does not exist', () => {
    const errors = validateYear(year([holiday({ date: '2026-02-30', date_be: '2569-02-30' })]));
    expect(errors.some((e) => e.includes('not a real calendar date'))).toBe(true);
  });

  it('catches year_be out of step with year', () => {
    expect(validateYear(year([holiday()], { year_be: 2570 }))).toHaveLength(1);
  });

  it('catches a provisional year with nothing provisional in it', () => {
    expect(validateYear(year([holiday()], { status: 'provisional' }))).toHaveLength(1);
  });
});

describe('override files', () => {
  const write = (yearBe: number, body: string): string => {
    const root = mkdtempSync(join(tmpdir(), 'overrides-'));
    writeFileSync(join(root, `${yearBe}.yaml`), body, 'utf8');
    return root;
  };

  it('reads unquoted dates, the way the README writes them', () => {
    const root = write(
      2569,
      [
        'add:',
        '  - date: 2026-10-16',
        '    type: special_cabinet',
        '    cabinet_resolution:',
        '      date: 2026-05-19',
        '      text: มติ ครม. 19 พ.ค. 2569',
        '    note: Announced on soc.go.th.',
      ].join('\n'),
    );
    const loaded = loadOverride(2569, root);
    expect(loaded?.add?.[0]?.date).toBe('2026-10-16');
    expect(loaded?.add?.[0]?.cabinet_resolution?.date).toBe('2026-05-19');
  });

  it('rejects a misspelt key instead of ignoring it', () => {
    const root = write(2569, 'add:\n  - date: 2026-10-16\n    is_dayoff: false\n    note: typo\n');
    expect(() => loadOverride(2569, root)).toThrow(/is_dayoff|Unrecognized/);
  });

  it('rejects an entry dated in another year', () => {
    const root = write(2569, 'remove:\n  - date: 2027-01-01\n    note: wrong file\n');
    expect(() => loadOverride(2569, root)).toThrow(/outside/);
  });
});

describe('pull request diff', () => {
  it('flags a cabinet grant on a date the data already had', () => {
    // ครม. granting a day the table listed as a working day is a change, not an addition.
    const before = year([holiday({ date: '2026-05-01', date_be: '2569-05-01', day_of_week: 'friday', is_day_off: false })]);
    const after = year([
      holiday({
        date: '2026-05-01',
        date_be: '2569-05-01',
        day_of_week: 'friday',
        type: 'special_cabinet',
        is_day_off: true,
        cabinet_resolution: { date: '2026-04-01', text: 'มติ ครม.' },
      }),
    ]);
    const diff = diffYear(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.cabinetChange).toBe(true);
  });

  it('does not flag an ordinary rename', () => {
    const diff = diffYear(year([holiday()]), year([holiday({ name_th: 'วันขึ้นปีใหม่ ' })]));
    expect(diff.cabinetChange).toBe(false);
  });
});

describe('current year', () => {
  it('follows Thai time, not UTC', () => {
    // 1 Jan 2027 03:00 in Bangkok is still 31 Dec 2026 in UTC.
    expect(currentYearCe(new Date('2026-12-31T20:00:00Z'))).toBe(2027);
    expect(currentYearCe(new Date('2026-12-31T16:59:59Z'))).toBe(2026);
  });
});

describe('year arguments', () => {
  it('reads lists and ranges', () => {
    expect(parseYearList('2570, 2560-2562', [])).toEqual([2560, 2561, 2562, 2570]);
    expect(parseYearList(undefined, [2569])).toEqual([2569]);
  });

  it('rejects anything it cannot read instead of selecting nothing', () => {
    expect(() => parseYearList('69', [])).toThrow(/69/);
    expect(() => parseYearList('2570-2569', [])).toThrow(/2570-2569/);
  });
});

describe('unrecognised names', () => {
  it('are not publishable', () => {
    const errors = validateYear(year([holiday({ key: 'unknown', name_en: 'วันอะไร' })]));
    expect(errors.some((e) => e.includes('no recognised key'))).toBe(true);
  });
});

describe('HTTP retries', () => {
  it('gives up at once on a client error', () => {
    expect(isRetryable(new HttpStatusError('forbidden', 403))).toBe(false);
    expect(isRetryable(new Error('curl: (22) The requested URL returned error: 404'))).toBe(false);
  });

  it('retries what may clear up', () => {
    expect(isRetryable(new HttpStatusError('busy', 503))).toBe(true);
    expect(isRetryable(new HttpStatusError('slow down', 429))).toBe(true);
    expect(isRetryable(new Error('curl: (28) Operation timed out'))).toBe(true);
  });
});

describe('site build', () => {
  it('drops files for years no longer in data/', () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'data-'));
    const outDir = mkdtempSync(join(tmpdir(), 'public-'));
    mkdirSync(join(outDir, 'holidays'));
    writeFileSync(join(outDir, 'holidays', '2599.json'), '{}', 'utf8');
    writeYear(year([holiday()]), dataRoot);

    buildSite(dataRoot, outDir);
    expect(readdirSync(join(outDir, 'holidays')).sort()).toEqual(['2026.json', '2569.json']);
  });
});
