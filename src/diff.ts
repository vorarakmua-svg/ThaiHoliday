import type { Holiday, HolidayYear } from './schema.js';

export interface YearDiff {
  yearBe: number;
  added: Holiday[];
  removed: Holiday[];
  changed: { before: Holiday; after: Holiday; fields: string[] }[];
  /** True when a special cabinet holiday appeared or disappeared. */
  cabinetChange: boolean;
}

/** Fields worth surfacing in a pull request. `confirmed_by` churns without meaning. */
const TRACKED: (keyof Holiday)[] = [
  'name_th',
  'name_en',
  'type',
  'status',
  'is_day_off',
  'substitutes_for',
  'cabinet_resolution',
];

function changedFields(before: Holiday, after: Holiday): string[] {
  return TRACKED.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

export function diffYear(before: HolidayYear | null, after: HolidayYear): YearDiff {
  const previous = new Map((before?.holidays ?? []).map((h) => [h.date, h]));
  const next = new Map(after.holidays.map((h) => [h.date, h]));

  const added = after.holidays.filter((h) => !previous.has(h.date));
  const removed = (before?.holidays ?? []).filter((h) => !next.has(h.date));
  const changed: YearDiff['changed'] = [];

  for (const holiday of after.holidays) {
    const old = previous.get(holiday.date);
    if (!old) continue;
    const fields = changedFields(old, holiday);
    if (fields.length > 0) changed.push({ before: old, after: holiday, fields });
  }

  const cabinetChange = [...added, ...removed].some((h) => h.type === 'special_cabinet');

  return { yearBe: after.year_be, added, removed, changed, cabinetChange };
}

export function isEmpty(diff: YearDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

function describe(holiday: Holiday): string {
  const parts = [holiday.name_th, `\`${holiday.type}\``, holiday.is_day_off ? 'day off' : 'not a day off'];
  if (holiday.cabinet_resolution) {
    parts.push(`มติ ครม. ${holiday.cabinet_resolution.date ?? 'date not cited'}`);
  }
  return parts.join(' · ');
}

/** Render one or more year diffs as the body of a pull request. */
export function renderPullRequestBody(diffs: YearDiff[], warnings: Map<number, string[]>): string {
  const lines: string[] = [];
  const substantive = diffs.filter((d) => !isEmpty(d));

  lines.push('Automated refresh of Thai government holiday data.', '');

  if (substantive.some((d) => d.cabinetChange)) {
    lines.push(
      '> [!IMPORTANT]',
      '> A **วันหยุดพิเศษ (ครม.)** was added or removed. Check it against the cabinet',
      '> resolution before merging — these are the days most likely to be parsed wrong.',
      '',
    );
  }

  for (const diff of substantive) {
    lines.push(`## พ.ศ. ${diff.yearBe}`, '');

    if (diff.added.length > 0) {
      lines.push('### Added', '', '| Date | Day | Holiday | Sources |', '| --- | --- | --- | --- |');
      for (const h of diff.added) {
        lines.push(`| ${h.date} | ${h.day_of_week} | ${describe(h)} | ${h.confirmed_by.join(', ')} |`);
      }
      lines.push('');
    }

    if (diff.removed.length > 0) {
      lines.push('### Removed', '', '| Date | Day | Holiday |', '| --- | --- | --- |');
      for (const h of diff.removed) {
        lines.push(`| ${h.date} | ${h.day_of_week} | ${describe(h)} |`);
      }
      lines.push('');
    }

    if (diff.changed.length > 0) {
      lines.push('### Changed', '', '| Date | Field | Before | After |', '| --- | --- | --- | --- |');
      for (const change of diff.changed) {
        for (const field of change.fields) {
          const before = JSON.stringify(change.before[field as keyof Holiday]);
          const after = JSON.stringify(change.after[field as keyof Holiday]);
          lines.push(`| ${change.after.date} | \`${field}\` | ${before} | ${after} |`);
        }
      }
      lines.push('');
    }

    const yearWarnings = warnings.get(diff.yearBe) ?? [];
    if (yearWarnings.length > 0) {
      lines.push('### Warnings', '');
      for (const warning of yearWarnings) lines.push(`- ${warning}`);
      lines.push('');
    }
  }

  if (substantive.length === 0) lines.push('No changes detected.', '');

  lines.push(
    '---',
    '',
    'Sources: [MyHora](https://myhora.com/calendar/), ' +
      '[Bank of Thailand](https://www.bot.or.th/th/financial-institutions-holiday.html), ' +
      'Google Thai holiday calendar, and computed statutory rules.',
  );

  return lines.join('\n');
}
