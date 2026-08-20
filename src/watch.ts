import type { HolidayYear, SourceId, SourceResult } from './schema.js';

/**
 * MyHora sits behind Cloudflare, which serves an interstitial challenge to datacenter
 * addresses. Both of its endpoints answer 403 from GitHub's runners while returning 200
 * from an ordinary connection, so a scheduled job there cannot rebuild a year.
 *
 * What it *can* do is watch. The Bank of Thailand and Google are both reachable, and BOT
 * announces the days ครม. grants — which is exactly the volatile part of the calendar.
 * This module compares those two against the committed data and reports anything they
 * know about that the repository does not, so a new มติ ครม. still surfaces within a day.
 *
 * It never edits data. Re-collection happens where MyHora is reachable.
 */

export interface WatchFinding {
  yearBe: number;
  date: string;
  source: SourceId;
  name_th: string;
  /** `cabinet` findings are the urgent ones: BOT only lists specially granted days. */
  severity: 'cabinet' | 'possible';
  detail: string;
}

/**
 * Google counts วันแรงงาน as a public holiday, and its compensatory day with it. Both are
 * days off for banks and the private sector and working days for government offices, so
 * they surface here every single year. A watchdog that reports a known-wrong result on
 * every run teaches you to ignore it, so this one class is filtered out.
 */
const GOOGLE_KNOWN_WRONG = /แรงงาน/;

export function compareYear(committed: HolidayYear, reachable: SourceResult[]): WatchFinding[] {
  const known = new Map(committed.holidays.map((h) => [h.date, h]));
  const findings: WatchFinding[] = [];

  for (const source of reachable) {
    for (const record of source.records) {
      if (!record.date.startsWith(`${committed.year}-`)) continue;
      if (source.source === 'google-ics' && GOOGLE_KNOWN_WRONG.test(record.name_th)) continue;

      const existing = known.get(record.date);
      const isCabinetWitness = source.source === 'bot-html';

      if (!existing) {
        findings.push({
          yearBe: committed.year_be,
          date: record.date,
          source: source.source,
          name_th: record.name_th,
          severity: isCabinetWitness ? 'cabinet' : 'possible',
          detail: isCabinetWitness
            ? 'BOT announces this as a specially granted day off, but it is not in the data at all. ' +
              'This is what a fresh มติ ครม. looks like.'
            : 'Google lists this as a public holiday, but it is not in the data. Google is often ' +
              'wrong on its own, so confirm before acting.',
        });
        continue;
      }

      // BOT disagreeing about whether a known date is a day off matters; Google disagreeing
      // does not, because Google wrongly counts วันแรงงาน and bank-only days as public.
      if (isCabinetWitness && !existing.is_day_off) {
        findings.push({
          yearBe: committed.year_be,
          date: record.date,
          source: source.source,
          name_th: record.name_th,
          severity: 'cabinet',
          detail: `BOT treats this as a granted day off, but the data has it as a working day (${existing.name_th}).`,
        });
      }
    }
  }

  return findings.sort((a, b) => a.date.localeCompare(b.date));
}

export function renderWatchReport(findings: WatchFinding[]): string {
  const lines: string[] = [];
  const cabinet = findings.filter((f) => f.severity === 'cabinet');

  lines.push(
    'The daily watch compared the sources reachable from GitHub Actions — the Bank of',
    'Thailand and Google — against the data committed here, and found dates they know',
    'about that this repository does not.',
    '',
  );

  if (cabinet.length > 0) {
    lines.push(
      '> [!IMPORTANT]',
      '> The Bank of Thailand is reporting a specially granted day off that is missing here.',
      '> BOT follows ครม. for one-off grants, so this most likely means a new มติ ครม.',
      '',
    );
  }

  lines.push('| Date | พ.ศ. | Reported by | As | Why it matters |', '| --- | --- | --- | --- | --- |');
  for (const f of findings) {
    lines.push(`| ${f.date} | ${f.yearBe} | \`${f.source}\` | ${f.name_th} | ${f.detail} |`);
  }

  lines.push(
    '',
    '## What to do',
    '',
    'MyHora is the only source carrying the lunar dates and the มติ ครม. notes, and it is not',
    'reachable from GitHub Actions. Re-collect from a machine where it is:',
    '',
    '```bash',
    'npm run refresh',
    '```',
    '',
    'Review the diff, then push it as a pull request. Close this issue once the data is updated.',
  );

  return lines.join('\n');
}
