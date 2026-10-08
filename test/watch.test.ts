import { describe, expect, it } from 'vitest';
import { compareYear, renderWatchReport } from '../src/watch.js';
import { parsePythonHolidays } from '../src/sources/python-holidays.js';
import type { HolidayYear, SourceResult } from '../src/schema.js';

const year = (holidays: Partial<HolidayYear['holidays'][number]>[]): HolidayYear => ({
  year: 2026,
  year_be: 2569,
  status: 'confirmed',
  frozen: false,
  generated_at: '2026-08-20T00:00:00Z',
  source_urls: [],
  warnings: [],
  holidays: holidays.map((h) => ({
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
  })) as HolidayYear['holidays'],
});

const source = (id: SourceResult['source'], records: SourceResult['records']): SourceResult => ({
  source: id,
  url: 'https://example.test',
  records,
  warnings: [],
});

describe('CI watchdog', () => {
  it('stays quiet when the reachable sources agree', () => {
    const findings = compareYear(year([{}]), [
      source('google-ics', [{ source: 'google-ics', date: '2026-01-01', name_th: 'วันขึ้นปีใหม่' }]),
    ]);
    expect(findings).toEqual([]);
  });

  it('raises a cabinet alert when BOT announces a day the data lacks', () => {
    // This is the case the whole watchdog exists for: MyHora is unreachable from Actions,
    // but BOT follows ครม. for one-off grants, so a fresh resolution still surfaces.
    const findings = compareYear(year([{}]), [
      source('bot-html', [
        { source: 'bot-html', date: '2026-10-16', name_th: 'วันหยุดพิเศษ (ครม.)', type: 'special_cabinet' },
      ]),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('cabinet');
    expect(findings[0]!.date).toBe('2026-10-16');
  });

  it('raises a cabinet alert when BOT contradicts a working day', () => {
    const findings = compareYear(
      year([{ date: '2026-10-16', is_day_off: false, name_th: 'วันธรรมดา' }]),
      [source('bot-html', [{ source: 'bot-html', date: '2026-10-16', name_th: 'วันหยุดพิเศษ (ครม.)' }])],
    );
    expect(findings[0]!.severity).toBe('cabinet');
    expect(findings[0]!.detail).toContain('working day');
  });

  it('treats a Google-only date as merely possible, not urgent', () => {
    const findings = compareYear(year([{}]), [
      source('google-ics', [{ source: 'google-ics', date: '2026-07-04', name_th: 'วันอะไรสักอย่าง' }]),
    ]);
    expect(findings[0]!.severity).toBe('possible');
  });

  it('ignores วันแรงงาน and its substitute, which Google always gets wrong', () => {
    // Both are days off for banks and working days for government offices, so without
    // this filter the watchdog would report them every year and train you to ignore it.
    const findings = compareYear(year([{}]), [
      source('google-ics', [
        { source: 'google-ics', date: '2027-05-01', name_th: 'วันแรงงานแห่งชาติ' },
        { source: 'google-ics', date: '2027-05-03', name_th: 'วันหยุดชดเชยวันแรงงานแห่งชาติ' },
      ]),
    ]);
    expect(findings).toEqual([]);
  });

  it('does not let Google contradict a known working day', () => {
    // Google marks วันแรงงาน a public holiday; the data correctly has it as a working day.
    // Only BOT is trusted to contradict us.
    const findings = compareYear(
      year([{ date: '2026-05-01', is_day_off: false, name_th: 'วันแรงงาน', key: 'labour_day' }]),
      [source('google-ics', [{ source: 'google-ics', date: '2026-05-01', name_th: 'วันหยุดอื่น' }])],
    );
    expect(findings).toEqual([]);
  });

  it('headlines the report when a cabinet day is involved', () => {
    const report = renderWatchReport([
      {
        yearBe: 2569,
        date: '2026-10-16',
        source: 'bot-html',
        name_th: 'วันหยุดพิเศษ (ครม.)',
        severity: 'cabinet',
        detail: 'test',
      },
    ]);
    expect(report).toContain('[!IMPORTANT]');
    expect(report).toContain('npm run refresh');
  });
});

describe('watching a year not yet collected', () => {
  it('reports a BOT grant against an empty year', () => {
    const empty = { ...year([]), holidays: [] };
    const findings = compareYear(empty, [
      source('bot-html', [
        { source: 'bot-html', date: '2026-10-16', name_th: 'วันหยุดพิเศษ (ครม.)', type: 'special_cabinet', is_day_off: true },
      ]),
    ]);
    expect(findings.map((f) => [f.date, f.severity])).toEqual([['2026-10-16', 'cabinet']]);
  });
});

describe('python-holidays as a witness', () => {
  const raw = JSON.stringify({
    version: '0.106',
    holidays: [
      { date: '2026-01-01', name_th: 'วันขึ้นปีใหม่' },
      { date: '2026-01-10', name_th: 'วันเด็กแห่งชาติ' },
      { date: '2026-05-01', name_th: 'วันแรงงานแห่งชาติ' },
      { date: '2026-12-07', name_th: 'ชดเชยวันพ่อแห่งชาติ' },
      { date: '2026-12-08', name_th: 'วันหยุดพิเศษ (เพิ่มเติม)' },
      { date: '2027-01-01', name_th: 'วันขึ้นปีใหม่' },
    ],
  });

  it('reads only the requested year', () => {
    expect(parsePythonHolidays(raw, 2569).records.map((r) => r.date)).not.toContain('2027-01-01');
  });

  it('reports weekday days off the data lacks or calls working days, and nothing else', () => {
    const committed = year([
      {},
      { date: '2026-12-07', date_be: '2569-12-07', day_of_week: 'monday', is_day_off: false, name_th: 'วันหยุดชดเชย' },
    ]);
    const findings = compareYear(committed, [parsePythonHolidays(raw, 2569)]);
    // วันเด็ก is a Saturday and วันแรงงาน is a working day for government offices.
    expect(findings.map((f) => [f.date, f.severity])).toEqual([
      ['2026-12-07', 'possible'],
      ['2026-12-08', 'possible'],
    ]);
  });

  it('fails loudly on output it does not understand', () => {
    expect(() => parsePythonHolidays('{"holidays": "nope"}', 2569)).toThrow();
  });
});
