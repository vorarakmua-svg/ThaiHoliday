import * as cheerio from 'cheerio';
import type { SourceResult } from '../schema.js';
import { fetchText } from '../http.js';
import { ceYear, iso, isValidIsoDate, monthFromThaiFull, THAI_MONTH_FULL } from '../rules/dates.js';

export const BOT_SOURCE = 'bot-html' as const;

export const BOT_URL = 'https://www.bot.or.th/th/financial-institutions-holiday.html';

/** A date written out in full, as BOT announcements phrase it: "วันศุกร์ที่ 16 ตุลาคม 2569". */
const FULL_THAI_DATE = new RegExp(
  `(\\d{1,2})\\s*(${THAI_MONTH_FULL.join('|')})\\s*(\\d{4})`,
  'g',
);

/** The phrase BOT uses when a day is granted on top of the customary holidays. */
const SPECIAL_GRANT = 'เพิ่มเป็นกรณีพิเศษ';

/**
 * How far after a date the grant phrase may sit and still refer to it. BOT phrases each
 * grant as the date followed by its description, so only the text after a date — and
 * before the next one — belongs to it. Looking backwards as well would let the page
 * heading ("...วันหยุดทำการเพิ่มเป็นกรณีพิเศษ...ประจำปี พ.ศ. 2569") mark any ordinary
 * holiday listed just below it as a cabinet grant.
 */
const CONTEXT_WINDOW = 250;

/**
 * The Bank of Thailand announces financial-institution holidays, which follow ครม. for
 * one-off grants. That makes the page a useful second witness for special cabinet days:
 * it confirmed 16 ตุลาคม 2569 while MyHora's calendar table still had no row for it.
 *
 * Only special grants are read. BOT's regular list is a different set from the government
 * one — it excludes วันพืชมงคล and includes วันแรงงาน — so importing it wholesale would be
 * wrong for this API. Note also that BOT sometimes scopes a grant to Bangkok only; that
 * nuance applies to banks, not to the nationwide วันหยุดราชการ this project publishes.
 */
export function parseBotHtml(html: string, yearBe: number): SourceResult {
  const yearCe = ceYear(yearBe);
  const text = cheerio.load(html).text().replace(/\s+/g, ' ');
  const seen = new Set<string>();
  const records: SourceResult['records'] = [];

  const matches = [...text.matchAll(FULL_THAI_DATE)];
  for (const [i, match] of matches.entries()) {
    const day = Number(match[1]);
    const month = monthFromThaiFull(match[2]!);
    const be = Number(match[3]);
    if (month === null || be !== yearBe) continue;

    const start = match.index + match[0].length;
    const next = matches[i + 1]?.index ?? text.length;
    const context = text.slice(start, Math.min(next, start + CONTEXT_WINDOW));
    if (!context.includes(SPECIAL_GRANT)) continue;

    const date = iso(yearCe, month, day);
    if (!isValidIsoDate(date) || seen.has(date)) continue;
    seen.add(date);

    records.push({
      source: BOT_SOURCE,
      date,
      name_th: 'วันหยุดพิเศษ (ครม.)',
      type: 'special_cabinet',
      is_day_off: true,
    });
  }

  return { source: BOT_SOURCE, url: BOT_URL, records, warnings: [] };
}

/**
 * Text the holiday page has always carried. Zero special grants is the normal state of the
 * page, so an empty result cannot reveal a moved page or an error document on its own.
 */
const PAGE_MARKER = 'วันหยุดของสถาบันการเงิน';

export async function fetchBotHtml(yearBe: number): Promise<SourceResult> {
  const html = await fetchText(BOT_URL);
  if (!html.includes(PAGE_MARKER)) {
    throw new Error(`${BOT_URL} no longer looks like the financial-institution holiday page.`);
  }
  return parseBotHtml(html, yearBe);
}
