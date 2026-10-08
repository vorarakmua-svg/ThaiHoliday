import type { HolidayYear, SourceId, SourceResult } from './schema.js';
import { isWeekend } from './rules/dates.js';

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
  /**
   * `cabinet` findings are the urgent ones: BOT only lists specially granted days, and a
   * new มติ ครม. usually reaches it first. They still need checking — a BOT grant can be
   * for banks only.
   */
  severity: 'cabinet' | 'possible';
  detail: string;
}

/**
 * Google and python-holidays both count วันแรงงาน as a public holiday, and its compensatory
 * day with it. Both are days off for banks and the private sector and working days for
 * government offices, so they would surface every single year. A watchdog that reports a
 * known-wrong result on every run teaches you to ignore it, so this one class is filtered out.
 */
const LABOUR_DAY = /แรงงาน/;

const DETAIL: Record<string, { missing: string; working: string }> = {
  'bot-html': {
    missing:
      'BOT grants banks a special day off here that the data does not have. Bank and ' +
      'government holidays differ, so this is not proof offices close — but a new มติ ครม. ' +
      'usually shows up here first. Check the resolution before adding it.',
    working:
      'BOT grants banks a special day off here, but the data has it as a working day for ' +
      'government offices. That may be right — check whether ครม. granted it too',
  },
  'google-ics': {
    missing:
      'Google lists this as a public holiday, but it is not in the data. Google is often ' +
      'wrong on its own, so confirm before acting.',
    working: '',
  },
  'python-holidays': {
    missing:
      'python-holidays has a weekday day off here that the data lacks. It is maintained by ' +
      'hand against มติ ครม., so check the resolution before acting.',
    working: 'python-holidays has a weekday day off here, but the data has it as a working day',
  },
};

export function compareYear(committed: HolidayYear, reachable: SourceResult[]): WatchFinding[] {
  const known = new Map(committed.holidays.map((h) => [h.date, h]));
  const findings: WatchFinding[] = [];

  for (const source of reachable) {
    const detail = DETAIL[source.source];
    if (!detail) continue;
    const isCabinetWitness = source.source === 'bot-html';

    for (const record of source.records) {
      if (!record.date.startsWith(`${committed.year}-`)) continue;
      if (!isCabinetWitness && LABOUR_DAY.test(record.name_th)) continue;
      // python-holidays lists observances that land on a weekend, which the data records
      // as non-days-off with a separate substitution. Only its weekdays are claims about
      // whether offices close.
      if (source.source === 'python-holidays' && isWeekend(record.date)) continue;

      const finding = (text: string): WatchFinding => ({
        yearBe: committed.year_be,
        date: record.date,
        source: source.source,
        name_th: record.name_th,
        severity: isCabinetWitness ? 'cabinet' : 'possible',
        detail: text,
      });

      const existing = known.get(record.date);
      if (!existing) {
        findings.push(finding(detail.missing));
        continue;
      }

      // A known date the data calls a working day matters from BOT and python-holidays;
      // not from Google, which wrongly counts bank-only days as public.
      if (detail.working && !existing.is_day_off) {
        findings.push(finding(`${detail.working} (${existing.name_th}).`));
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
    'Thailand, Google and python-holidays — against the data committed here, and found',
    'days off they know about that this repository does not.',
    '',
  );

  if (cabinet.length > 0) {
    lines.push(
      '> [!IMPORTANT]',
      '> The Bank of Thailand granted banks a special day off that is missing here. BOT',
      '> usually follows ครม. for one-off grants, but bank and government holidays differ:',
      '> confirm a มติ ครม. covers government offices before adding it.',
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
