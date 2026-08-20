import * as cheerio from 'cheerio';
import type { CabinetResolution, SourceRecord, SourceResult } from '../schema.js';
import { fetchText } from '../http.js';
import {
  ceYear,
  expandBuddhistYear,
  iso,
  isValidIsoDate,
  monthFromThaiAbbr,
  monthFromThaiFull,
  isWeekend,
} from '../rules/dates.js';
import { normaliseThai, resolveName } from '../rules/names.js';

export const MYHORA_SOURCE = 'myhora-html' as const;

export function myhoraUrl(yearBe: number): string {
  return `https://myhora.com/calendar/holiday-${yearBe}.aspx`;
}

/** Marks a government day off in the ราชการ column; an em dash marks a working day. */
const DAY_OFF = 'หยุด';

/**
 * A Thai abbreviated date such as "16 ต.ค. 69". The month pattern tolerates stray spaces
 * because MyHora emits malformed abbreviations — the 2568 remark contains "11 ส.ค .2568".
 * The character class spans the whole Thai block so that leading-vowel months such as
 * "เม.ย." match as well as consonant-initial ones.
 */
const THAI_DATE_SOURCE =
  '(\\d{1,2})\\s*([\\u0E01-\\u0E4E]{1,3}\\s*\\.\\s*[\\u0E01-\\u0E4E]{1,2}\\s*\\.)\\s*(\\d{2,4})';

/**
 * Text that follows a cabinet holiday but describes something else. The 19 พ.ค. 2569
 * resolution grants one holiday and then lists work-from-home days, which are not days off.
 * Truncating at "และให้" rather than a bare "และ" keeps multi-day grants intact
 * ("คือ 2 มิ.ย. 2568 และ 11 ส.ค .2568").
 */
const NOT_A_HOLIDAY = /และให้|เวิร์กฟรอมโฮม|WFH|\(/;

/** MyHora states outright when a year's calendar is computed rather than verified. */
const PROVISIONAL_MARKER = /บันทึกข้อมูลล่วงหน้า|จะตรวจสอบเรียบร้อยประมาณ/;

/**
 * ครม. also grants วันหยุดราชการประจำภาค — days off in one region only. The 29 ธ.ค. 2563
 * resolution grants four national holidays and then five regional ones in the same
 * sentence, and the 5 พ.ย. 2564 resolution grants 28 ธ.ค. to the eastern region alone.
 * Publishing either as a nationwide holiday would be wrong, so regional grants are
 * skipped and reported instead.
 */
const REGIONAL_GRANT = /ประจำภาค|\[ภาค|ภาคเหนือ|ภาคใต้|ภาคกลาง|ภาคตะวันออก|ภาคตะวันตก|เฉพาะพื้นที่|เฉพาะจังหวัด/;

/** ธปท. announcements in the same note concern bank holidays, not government ones. */
const BANK_ONLY_GRANT = /ธปท\.|วันหยุดธนาคาร/;

/**
 * A bare day number joined by a comma to the date that follows it, as in
 * "19 , 20 พ.ย. 2563" or "4 , 7 ก.ย. 2563" — one month and year shared by several days.
 */
const TRAILING_DAY_LIST = /(\d{1,2})\s*[,،]\s*$/;

function extractDates(segment: string): string[] {
  const pattern = new RegExp(THAI_DATE_SOURCE, 'g');
  const out: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(segment)) !== null) {
    const before = segment.slice(0, match.index);
    // "13-15 เม.ย. 2563" is a range. Reading only its end would turn a three-day
    // postponement into a single spurious holiday, so ranges are skipped entirely.
    if (/[-–—]\s*$/.test(before)) continue;

    const month = monthFromThaiAbbr(match[2]!);
    const be = expandBuddhistYear(match[3]!);
    if (month === null || !Number.isFinite(be)) continue;
    const yearCe = ceYear(be);

    // Walk back over any "D , " prefixes so every day in the list shares this month.
    const days = [Number(match[1])];
    let head = before;
    let listMatch: RegExpExecArray | null;
    while ((listMatch = TRAILING_DAY_LIST.exec(head)) !== null) {
      days.unshift(Number(listMatch[1]));
      head = head.slice(0, listMatch.index);
    }

    for (const day of days) {
      const isoDate = iso(yearCe, month, day);
      if (isValidIsoDate(isoDate) && !out.includes(isoDate)) out.push(isoDate);
    }
  }

  return out;
}

export interface CabinetAction {
  kind: 'add' | 'move';
  /** Dates granted as holidays, ISO (CE). */
  dates: string[];
  /** For a move: the date the holiday was taken away from. */
  movedFrom?: string;
  resolution: CabinetResolution;
}

/**
 * Parse the มติ ครม. notes MyHora prints above the calendar.
 *
 * These matter because the table can lag the note: for 2569 the note announces a special
 * holiday on 16 ต.ค. that has no row in the calendar at all.
 *
 * One line may pack several resolutions ("มติ ครม. 25 ต.ค. 2566 ... , มติ ครม. 13 ก.พ. 2567 ...")
 * and one resolution may carry several actions, so the text is split twice: first at each
 * "มติ ครม." marker, then at each action verb.
 */
export function parseCabinetNotes(remarkLines: string[]): {
  actions: CabinetAction[];
  warnings: string[];
} {
  const actions: CabinetAction[] = [];
  const warnings: string[] = [];

  for (const line of remarkLines) {
    if (!line.includes('มติ ครม.')) continue;

    const clauses = line
      .split(/(?=มติ ครม\.)/)
      .map((clause) => clause.trim())
      .filter((clause) => clause.startsWith('มติ ครม.'));

    for (const clause of clauses) {
      // The resolution's own date is the first date in the clause, right after the marker.
      const resolutionDate = extractDates(clause.slice(0, 40))[0] ?? null;
      const resolution: CabinetResolution = {
        date: resolutionDate,
        text: clause.replace(/\s*,\s*$/, ''),
      };

      const verbs = [...clause.matchAll(/เลื่อน|เพิ่ม|ยกเลิก|ประกาศ/g)];
      let found = 0;

      for (let i = 0; i < verbs.length; i += 1) {
        const start = verbs[i]!.index;
        const end = i + 1 < verbs.length ? verbs[i + 1]!.index : clause.length;
        const segment = clause.slice(start, end);
        const verb = verbs[i]![0];

        if (verb === 'เลื่อน') {
          const fromPart = /จาก([\s\S]*?)(?=เป็น|$)/.exec(segment)?.[1] ?? '';
          const toPart = /เป็น([\s\S]*)$/.exec(segment)?.[1] ?? '';
          const movedFrom = extractDates(fromPart)[0];
          const movedTo = extractDates(toPart)[0];
          if (movedFrom || movedTo) {
            actions.push({
              kind: 'move',
              dates: movedTo ? [movedTo] : [],
              ...(movedFrom ? { movedFrom } : {}),
              resolution,
            });
            found += 1;
          }
          continue;
        }

        if (verb === 'เพิ่ม' || verb === 'ประกาศ') {
          // Grants are usually introduced by "คือ", but not always: the 23 ก.ย. 2563
          // resolution reads "เพิ่มเติมเป็นกรณีพิเศษ 19 , 20 พ.ย. 2563" with no such marker.
          // A ประกาศ segment only counts when it actually declares a holiday — the same
          // word also opens postponements ("ประกาศเลื่อน...ออกไปก่อน").
          const body = segment.split('คือ')[1] ?? segment;
          if (verb === 'ประกาศ' && !body.includes('วันหยุด')) continue;

          // Scope is checked after truncation, not before: the 2569 note ends with
          // "(เฉพาะพื้นที่กรุงเทพฯ)" describing its work-from-home days, while the holiday
          // it grants is nationwide.
          const grant = body.split(NOT_A_HOLIDAY)[0] ?? body;
          if (REGIONAL_GRANT.test(grant)) {
            warnings.push(
              `Skipped a regional holiday grant (วันหยุดราชการประจำภาค), which is not a ` +
                `nationwide day off: "${grant.trim()}"`,
            );
            found += 1;
            continue;
          }
          if (BANK_ONLY_GRANT.test(grant)) {
            warnings.push(`Skipped a ธปท. bank holiday grant, which is out of scope: "${grant.trim()}"`);
            found += 1;
            continue;
          }

          const dates = extractDates(grant);
          if (dates.length > 0) {
            actions.push({ kind: 'add', dates, resolution });
            found += 1;
          }
        }

        // "ยกเลิก" is matched only so segments split correctly. A cancellation is never
        // applied automatically — it falls through to the warning below for a human.
      }

      if (found === 0) {
        warnings.push(`Could not extract any holiday change from cabinet note: "${clause}"`);
      }
    }
  }

  return { actions, warnings };
}

/** Split the remark block into individual lines of text. */
export function extractRemarkLines(html: string): string[] {
  const $ = cheerio.load(html);
  const lines: string[] = [];
  $('#p_calendar_remark .box-red-lite').each((_, el) => {
    const inner = $(el).html() ?? '';
    for (const part of inner.split(/<br\s*\/?>/i)) {
      const text = normaliseThai(cheerio.load(`<div>${part}</div>`)('div').text());
      if (text) lines.push(text);
    }
  });
  return lines;
}

/**
 * A substitution in the first days of January usually compensates วันสิ้นปี from the year
 * before — 31 ธ.ค. 2560 fell on a Sunday, so the day off landed on 2 ม.ค. 2561. The
 * observance sits in the previous year's calendar, so it can never be found among this
 * year's rows and has to be reconstructed. วันสิ้นปี is a fixed date, which makes that safe.
 */
function carriedOverNewYearsEve(
  substitutionDate: string,
  yearCe: number,
): { date: string; name_th: string } | null {
  const dayOfMonth = Number(substitutionDate.slice(8));
  if (!substitutionDate.startsWith(`${yearCe}-01-`) || dayOfMonth > 5) return null;

  const newYearsEve = iso(yearCe - 1, 12, 31);
  return isWeekend(newYearsEve) ? { date: newYearsEve, name_th: 'วันสิ้นปี' } : null;
}

export interface ParsedMyhora {
  records: SourceRecord[];
  warnings: string[];
  provisional: boolean;
  actions: CabinetAction[];
}

export function parseMyhoraHtml(html: string, yearBe: number): ParsedMyhora {
  const $ = cheerio.load(html);
  const yearCe = ceYear(yearBe);
  const warnings: string[] = [];
  const records: SourceRecord[] = [];

  const rows = $('div.dxl')
    .toArray()
    .filter((el) => $(el).find('.dxl-dmy-d').length > 0);
  if (rows.length === 0) {
    warnings.push('MyHora page contained no calendar rows — the page layout may have changed.');
  }

  interface Row {
    date: string;
    name_th: string;
    isDayOff: boolean;
  }
  const parsedRows: Row[] = [];

  for (const el of rows) {
    const $row = $(el);
    const day = Number($row.find('.dxl-dmy-d').first().text().trim());
    const month = monthFromThaiFull($row.find('.dxl-dmy-m').first().text());
    const rowYearBe = Number($row.find('.dxl-dmy-y').first().text().trim());
    const name_th = normaliseThai($row.find('.dxl-dn').first().text());
    // .dxl-dn2 is the ราชการ column, .dxl-dn3 the ธนาคาร one. Only the former is in scope.
    const governmentColumn = normaliseThai($row.find('.dxl-dn2').first().text());

    if (!Number.isFinite(day) || month === null || rowYearBe !== yearBe) continue;
    // MyHora leaves the label blank on bank-only substitution rows, e.g. 3 พ.ค. 2570.
    if (!name_th) continue;

    const date = iso(ceYear(yearBe), month, day);
    if (!isValidIsoDate(date)) {
      warnings.push(`Skipped an unparseable calendar row: ${day}/${month}/${yearBe} "${name_th}"`);
      continue;
    }
    parsedRows.push({ date, name_th, isDayOff: governmentColumn === DAY_OFF });
  }

  parsedRows.sort((a, b) => a.date.localeCompare(b.date));

  // A substitution row does not say what it compensates, so it is paired with the most
  // recent unclaimed observance that fell on a weekend — which is how MyHora lays the
  // calendar out (31 พ.ค. วิสาขบูชา as a non-day-off, then 1 มิ.ย. วันหยุดชดเชย).
  //
  // Only weekend observances are eligible. Without that filter วันแรงงาน, which is a
  // working day for government offices on any weekday, would sit in the queue and steal
  // the pairing from the holiday actually being compensated.
  //
  // The pairing is inferred, not stated by the source. When ครม. grants fewer
  // substitutions than there were weekend holidays — as in 2567 — attribution between
  // two adjacent weekend days is genuinely ambiguous and the nearest one is assumed.
  const unclaimed: Row[] = [];
  for (const row of parsedRows) {
    const resolved = resolveName(row.name_th);
    if (!resolved.matched) {
      warnings.push(`Unrecognised holiday name "${row.name_th}" on ${row.date}.`);
    }

    let substitutesFor: SourceRecord['substitutes_for'] = null;
    if (resolved.type === 'substitution') {
      const target = unclaimed.pop() ?? carriedOverNewYearsEve(row.date, yearCe);
      if (target) {
        substitutesFor = { date: target.date, name_th: target.name_th };
      } else {
        warnings.push(`Substitution on ${row.date} has no preceding observance to compensate.`);
      }
    } else if (!row.isDayOff && isWeekend(row.date)) {
      unclaimed.push(row);
    }

    records.push({
      source: MYHORA_SOURCE,
      date: row.date,
      name_th: row.name_th,
      is_day_off: row.isDayOff,
      type: resolved.type,
      substitutes_for: substitutesFor,
    });
  }

  const remarkLines = extractRemarkLines(html);
  const provisional = remarkLines.some((line) => PROVISIONAL_MARKER.test(line));
  const { actions, warnings: noteWarnings } = parseCabinetNotes(remarkLines);
  warnings.push(...noteWarnings);

  // Fold the cabinet notes into the record set. A note may confirm a row the table already
  // has — attaching the resolution to it — or introduce a day the table is missing entirely.
  for (const action of actions) {
    for (const date of action.dates) {
      if (!date.startsWith(`${yearCe}-`)) continue;
      const existing = records.find((record) => record.date === date);
      if (existing) {
        existing.cabinet_resolution = action.resolution;
        existing.is_day_off = true;
        if (existing.type !== 'substitution') existing.type = 'special_cabinet';
      } else {
        records.push({
          source: MYHORA_SOURCE,
          date,
          name_th: 'วันหยุดพิเศษ (ครม.)',
          is_day_off: true,
          type: 'special_cabinet',
          substitutes_for: null,
          cabinet_resolution: action.resolution,
        });
        warnings.push(
          `Cabinet note grants ${date} but MyHora's calendar table has no row for it — verify before merging.`,
        );
      }
    }

    if (action.kind === 'move' && action.movedFrom?.startsWith(`${yearCe}-`)) {
      const index = records.findIndex((record) => record.date === action.movedFrom);
      if (index >= 0) records.splice(index, 1);
      warnings.push(
        `Cabinet note moves the holiday away from ${action.movedFrom}; it was dropped from ${yearBe}.`,
      );
    }
  }

  records.sort((a, b) => a.date.localeCompare(b.date));
  return { records, warnings, provisional, actions };
}

export async function fetchMyhoraHtml(yearBe: number): Promise<SourceResult> {
  const url = myhoraUrl(yearBe);
  const html = await fetchText(url);
  const parsed = parseMyhoraHtml(html, yearBe);
  return {
    source: MYHORA_SOURCE,
    url,
    records: parsed.records,
    warnings: parsed.warnings,
    provisional: parsed.provisional,
  };
}
