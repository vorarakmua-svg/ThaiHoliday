import { describe, expect, it } from 'vitest';
import { mergeYear } from '../src/merge.js';
import type { SourceResult } from '../src/schema.js';

const source = (
  id: SourceResult['source'],
  records: SourceResult['records'],
  warnings: string[] = [],
): SourceResult => ({ source: id, url: `https://example.test/${id}`, records, warnings });

const NEW_YEAR = { date: '2026-01-01', name_th: 'วันขึ้นปีใหม่', type: 'public' as const, is_day_off: true };

describe('source precedence', () => {
  it('prefers MyHora’s name over Google’s', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [
        source('google-ics', [{ source: 'google-ics', date: '2026-01-01', name_th: 'วันขื้นปีใหม่' }]),
        source('myhora-html', [{ source: 'myhora-html', ...NEW_YEAR }]),
      ],
    });
    expect(result.holidays[0]!.name_th).toBe('วันขึ้นปีใหม่');
    expect(result.holidays[0]!.confirmed_by).toEqual(['myhora-html', 'google-ics']);
  });

  it('lets MyHora override the computed rules on whether a day is off', () => {
    // 1 May is in Google's feed and absent from the rules; MyHora alone knows government
    // offices stay open.
    const result = mergeYear({
      yearBe: 2569,
      sources: [
        source('rules', [{ source: 'rules', date: '2026-05-01', name_th: 'วันแรงงาน', is_day_off: true }]),
        source('myhora-html', [
          { source: 'myhora-html', date: '2026-05-01', name_th: 'วันแรงงาน', is_day_off: false },
        ]),
      ],
    });
    expect(result.holidays[0]!.is_day_off).toBe(false);
  });
});

describe('Google is corroboration only', () => {
  it('refuses to introduce a date no authoritative source reports', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [
        source('google-ics', [
          { source: 'google-ics', date: '2026-02-14', name_th: 'วันวาเลนไทน์' },
        ]),
      ],
    });
    expect(result.holidays).toEqual([]);
    expect(result.warnings.some((w) => w.includes('2026-02-14'))).toBe(true);
  });

  it('still records its agreement when another source found the date', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [
        source('myhora-html', [{ source: 'myhora-html', ...NEW_YEAR }]),
        source('google-ics', [{ source: 'google-ics', date: '2026-01-01', name_th: 'วันขื้นปีใหม่' }]),
      ],
    });
    expect(result.holidays[0]!.confirmed_by).toContain('google-ics');
  });
});

describe('the computed rules must not reinstate a cancelled holiday', () => {
  it('refuses to introduce a statutory date when it is only corroborating', () => {
    // ครม. postponed Songkran 2563 for COVID. MyHora correctly dropped those rows, and
    // the rules must not put them back — government offices were open.
    const result = mergeYear({
      yearBe: 2563,
      sources: [
        {
          source: 'rules',
          url: 'computed',
          corroborateOnly: true,
          warnings: [],
          records: [
            { source: 'rules', date: '2020-04-13', name_th: 'วันสงกรานต์', is_day_off: true },
          ],
        },
        source('myhora-html', [
          { source: 'myhora-html', date: '2020-01-01', name_th: 'วันขึ้นปีใหม่', type: 'public', is_day_off: true },
        ]),
      ],
    });
    expect(result.holidays.map((h) => h.date)).toEqual(['2020-01-01']);
    expect(result.warnings.some((w) => w.includes('ครม.') && w.includes('2020-04-13'))).toBe(true);
  });

  it('still introduces statutory dates when the primary source failed outright', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [source('rules', [{ ...NEW_YEAR, source: 'rules' }])],
    });
    expect(result.holidays.map((h) => h.date)).toEqual(['2026-01-01']);
  });
});

describe('status semantics', () => {
  it('warns about a missing citation without casting doubt on the day itself', () => {
    // A day off that already happened is a matter of record even if MyHora never printed
    // the resolution behind it. Marking it provisional would tell consumers to doubt
    // something certain, so the gap is reported as a warning instead.
    const withoutResolution = mergeYear({
      yearBe: 2569,
      sources: [
        source('myhora-html', [
          {
            source: 'myhora-html',
            date: '2026-10-16',
            name_th: 'วันหยุดพิเศษ (ครม.)',
            type: 'special_cabinet',
            is_day_off: true,
          },
        ]),
      ],
    });
    expect(withoutResolution.holidays[0]!.status).toBe('confirmed');
    expect(withoutResolution.warnings.some((w) => w.includes('no มติ ครม. cited'))).toBe(true);

    const withResolution = mergeYear({
      yearBe: 2569,
      sources: [
        source('myhora-html', [
          {
            source: 'myhora-html',
            date: '2026-10-16',
            name_th: 'วันหยุดพิเศษ (ครม.)',
            type: 'special_cabinet',
            is_day_off: true,
            cabinet_resolution: { date: '2026-05-19', text: 'มติ ครม. 19 พ.ค. 2569' },
          },
        ]),
      ],
    });
    expect(withResolution.holidays[0]!.status).toBe('confirmed');
  });

  it('keeps fixed statutory dates confirmed even in a provisional year', () => {
    const result = mergeYear({
      yearBe: 2570,
      provisional: true,
      sources: [
        source('rules', [{ source: 'rules', date: '2027-01-01', name_th: 'วันขึ้นปีใหม่', is_day_off: true }]),
        source('myhora-html', [
          { source: 'myhora-html', date: '2027-01-01', name_th: 'วันขึ้นปีใหม่', type: 'public', is_day_off: true },
          { source: 'myhora-html', date: '2027-05-20', name_th: 'วันวิสาขบูชา', type: 'public', is_day_off: true },
        ]),
      ],
    });
    const byDate = Object.fromEntries(result.holidays.map((h) => [h.date, h.status]));
    // New Year is statutory and does not depend on ครม.; Visakha Bucha moves each year.
    expect(byDate['2027-01-01']).toBe('confirmed');
    expect(byDate['2027-05-20']).toBe('provisional');
    expect(result.status).toBe('provisional');
  });
});

describe('overrides', () => {
  it('introduces a day no source could reach', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [source('myhora-html', [{ source: 'myhora-html', ...NEW_YEAR }])],
      override: {
        add: [
          {
            date: '2026-10-16',
            name_th: 'วันหยุดพิเศษ (ครม.)',
            type: 'special_cabinet',
            cabinet_resolution: { date: '2026-05-19', text: 'มติ ครม. 19 พ.ค. 2569' },
            note: 'Announced on soc.go.th, which cannot be scraped.',
          },
        ],
      },
    });
    const added = result.holidays.find((h) => h.date === '2026-10-16');
    expect(added?.status).toBe('confirmed');
    expect(added?.confirmed_by).toContain('override');
  });

  it('removes a date a source reported in error', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [source('myhora-html', [{ source: 'myhora-html', ...NEW_YEAR }])],
      override: { remove: [{ date: '2026-01-01', note: 'Reported in error.' }] },
    });
    expect(result.holidays).toEqual([]);
  });

  it('warns about a stale removal that matches nothing', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [source('myhora-html', [{ source: 'myhora-html', ...NEW_YEAR }])],
      override: { remove: [{ date: '2026-07-04', note: 'Never existed.' }] },
    });
    expect(result.warnings.some((w) => w.includes('Stale override'))).toBe(true);
  });

  it('outranks every scraped source', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [source('myhora-html', [{ source: 'myhora-html', ...NEW_YEAR }])],
      override: {
        add: [{ date: '2026-01-01', is_day_off: false, note: 'Cabinet cancelled it.' }],
      },
    });
    expect(result.holidays[0]!.is_day_off).toBe(false);
  });

  it('applies the English name and status it was given', () => {
    // Both fields are accepted by the override schema; they must not be silently dropped.
    const result = mergeYear({
      yearBe: 2570,
      provisional: true,
      sources: [source('myhora-html', [{ source: 'myhora-html', ...NEW_YEAR, date: '2027-01-01' }])],
      override: {
        add: [
          {
            date: '2027-01-01',
            name_en: 'New Year',
            status: 'confirmed',
            note: 'Ratified early.',
          },
        ],
      },
    });
    expect(result.holidays[0]!.name_en).toBe('New Year');
    expect(result.holidays[0]!.status).toBe('confirmed');
  });

  it('refuses to add a date from another year', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [source('myhora-html', [{ source: 'myhora-html', ...NEW_YEAR }])],
      override: { add: [{ date: '2027-01-04', note: 'Filed in the wrong year.' }] },
    });
    expect(result.holidays.map((h) => h.date)).toEqual(['2026-01-01']);
    expect(result.warnings.some((w) => w.includes('2027-01-04'))).toBe(true);
  });
});

describe('cross-checks over the merged year', () => {
  it('rejects a substitution that claims to compensate a weekday', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [
        source('myhora-html', [
          {
            source: 'myhora-html',
            date: '2026-06-01',
            name_th: 'วันหยุดชดเชย',
            type: 'substitution',
            is_day_off: true,
            // 2026-05-01 is a Friday, so it can never need compensating.
            substitutes_for: { date: '2026-05-01', name_th: 'วันแรงงาน' },
          },
        ]),
      ],
    });
    expect(result.warnings.some((w) => w.includes('which is a weekday'))).toBe(true);
  });

  it('flags a day off that lands on a weekend', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [
        source('myhora-html', [
          {
            source: 'myhora-html',
            date: '2026-05-31',
            name_th: 'วันวิสาขบูชา',
            type: 'public',
            is_day_off: true,
          },
        ]),
      ],
    });
    expect(result.warnings.some((w) => w.includes('falls on a sunday'))).toBe(true);
  });

  it('flags an implausible number of days off', () => {
    const result = mergeYear({
      yearBe: 2569,
      sources: [source('myhora-html', [{ source: 'myhora-html', ...NEW_YEAR }])],
    });
    expect(result.warnings.some((w) => w.includes('outside the expected range'))).toBe(true);
  });
});
