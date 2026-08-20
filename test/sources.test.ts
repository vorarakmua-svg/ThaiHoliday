import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseIcs } from '../src/sources/ics.js';
import { parseGoogleIcs } from '../src/sources/google-ics.js';
import { parseMyhoraIcs } from '../src/sources/myhora-ics.js';
import { parseBotHtml } from '../src/sources/bot-html.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const googleIcs = fixture('google-th.ics');
const myhoraIcs = fixture('myhora-current.ics');
const botHtml = fixture('bot-fi-holiday.html');

describe('iCalendar reader', () => {
  it('unfolds continuation lines', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260102',
      'SUMMARY:วันหยุด',
      ' พิเศษ',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(raw)).toEqual([
      { date: '2026-01-02', summary: 'วันหยุดพิเศษ', description: '' },
    ]);
  });

  it('ignores events without an all-day DTSTART', () => {
    const raw = 'BEGIN:VEVENT\nDTSTART:20260102T090000Z\nSUMMARY:ประชุม\nEND:VEVENT';
    expect(parseIcs(raw)).toEqual([]);
  });
});

describe('Google iCalendar feed', () => {
  const y2569 = parseGoogleIcs(googleIcs, 2569);

  it('keeps only วันหยุดนักขัตฤกษ์ entries', () => {
    const dates = y2569.records.map((r) => r.date);
    // Valentine's Day and Christmas are in the feed but are not holidays.
    expect(dates).not.toContain('2026-02-14');
    expect(dates).not.toContain('2026-12-25');
    expect(dates).toContain('2026-01-01');
  });

  it('is demonstrably incomplete, which is why it cannot be the primary source', () => {
    const dates = y2569.records.map((r) => r.date);
    // วันเข้าพรรษา (30 ก.ค. 2569) is a government holiday that Google omits.
    expect(dates).not.toContain('2026-07-30');
    // The 16 ต.ค. 2569 cabinet holiday is missing too.
    expect(dates).not.toContain('2026-10-16');
  });

  it('carries names too unreliable to trust', () => {
    // Google labels the 2 ม.ค. 2569 cabinet holiday "วันหยุดราชการธันวาคม".
    const january = y2569.records.find((r) => r.date === '2026-01-02');
    expect(january?.name_th).toBe('วันหยุดราชการธันวาคม');
    // And in 2568 it labels both cabinet holidays with a bare "นักขัตฤกษ์".
    const y2568 = parseGoogleIcs(googleIcs, 2568);
    expect(y2568.records.find((r) => r.date === '2025-06-02')?.name_th).toBe('นักขัตฤกษ์');
  });

  it('warns when asked for a year outside the feed', () => {
    expect(parseGoogleIcs(googleIcs, 2600).warnings).toHaveLength(1);
  });
});

describe('MyHora iCalendar feed', () => {
  it('corroborates the current year', () => {
    expect(parseMyhoraIcs(myhoraIcs, 2569).records.length).toBeGreaterThan(20);
  });

  it('returns nothing rather than wrong data for other years', () => {
    // The feed ignores every year parameter and always serves the current year.
    const result = parseMyhoraIcs(myhoraIcs, 2570);
    expect(result.records).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('Bank of Thailand announcements', () => {
  it('finds only the specially granted days', () => {
    const result = parseBotHtml(botHtml, 2569);
    expect(result.records.map((r) => r.date)).toEqual(['2026-01-02', '2026-10-16']);
    expect(result.records.every((r) => r.type === 'special_cabinet')).toBe(true);
  });

  it('independently confirms the day MyHora’s table was missing', () => {
    // This is the whole point of keeping BOT as a witness: 16 ต.ค. 2569 exists in the
    // cabinet note and in BOT's announcement, but not in MyHora's calendar table.
    const result = parseBotHtml(botHtml, 2569);
    expect(result.records.some((r) => r.date === '2026-10-16')).toBe(true);
  });

  it('does not import BOT’s regular holiday list', () => {
    const result = parseBotHtml(botHtml, 2569);
    // วันแรงงาน is a bank holiday but not a government one; it must not leak in.
    expect(result.records.map((r) => r.date)).not.toContain('2026-05-01');
  });

  it('returns nothing for a year the page does not cover', () => {
    expect(parseBotHtml(botHtml, 2560).records).toEqual([]);
  });
});
