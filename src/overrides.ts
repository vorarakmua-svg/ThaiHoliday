import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { HolidayStatus, HolidayType } from './schema.js';
import { ceYear, isValidIsoDate } from './rules/dates.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const OverrideEntry = z.object({
  date: z.string().regex(ISO_DATE),
  name_th: z.string().min(1).optional(),
  name_en: z.string().min(1).optional(),
  type: HolidayType.optional(),
  status: HolidayStatus.optional(),
  is_day_off: z.boolean().optional(),
  cabinet_resolution: z
    .object({ date: z.string().regex(ISO_DATE).nullable(), text: z.string().min(1) })
    .strict()
    .nullable()
    .optional(),
  /** Why this override exists. Required so the file explains itself to the next reader. */
  note: z.string().min(1),
}).strict();

/**
 * Hand-written corrections, applied above every scraped source.
 *
 * This is the sanctioned route for anything the collector cannot reach on its own — most
 * importantly announcements published only on soc.go.th, which sits behind a Cloudflare
 * challenge and is deliberately not scraped.
 */
export const OverrideFile = z.object({
  /** Dates to introduce, or to enrich if a source already found them. */
  add: z.array(OverrideEntry).optional(),
  /** Dates to drop entirely, e.g. one a source reported in error. */
  remove: z
    .array(z.object({ date: z.string().regex(ISO_DATE), note: z.string().min(1) }).strict())
    .optional(),
  // Strict throughout: a misspelt key ("ad:", "is_dayoff:") would otherwise be dropped
  // without a word, and the correction it carried would silently never apply.
}).strict();

export type OverrideEntry = z.infer<typeof OverrideEntry>;
export type OverrideFile = z.infer<typeof OverrideFile>;

export function overridePath(yearBe: number, root = 'data/overrides'): string {
  return join(root, `${yearBe}.yaml`);
}

export function loadOverride(yearBe: number, root = 'data/overrides'): OverrideFile | null {
  const path = overridePath(yearBe, root);
  if (!existsSync(path)) return null;
  // CORE_SCHEMA, not the default: the default turns an unquoted `date: 2026-10-16` — the
  // natural way to write one, and the form the README shows — into a JS Date, which the
  // schema then rejects.
  const parsed = yaml.load(readFileSync(path, 'utf8'), { schema: yaml.CORE_SCHEMA });
  if (parsed === null || parsed === undefined) return null;
  const result = OverrideFile.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`${path} is not a valid override file: ${detail}`);
  }
  const errors = checkOverride(yearBe, result.data);
  if (errors.length > 0) throw new Error(`${path}: ${errors.join(' ')}`);
  return result.data;
}

/**
 * Checks the schema cannot express. An entry dated in another year would otherwise be
 * merged into this one, where it fails validation far from the line that caused it.
 */
export function checkOverride(yearBe: number, file: OverrideFile): string[] {
  const errors: string[] = [];
  const yearCe = ceYear(yearBe);
  const entries = [...(file.add ?? []), ...(file.remove ?? [])];
  for (const { date } of entries) {
    if (!isValidIsoDate(date)) errors.push(`${date} is not a real calendar date.`);
    else if (!date.startsWith(`${yearCe}-`)) errors.push(`${date} is outside พ.ศ. ${yearBe} (${yearCe}).`);
  }
  const added = (file.add ?? []).map((entry) => entry.date);
  for (const date of new Set(added.filter((date, i) => added.indexOf(date) !== i))) {
    errors.push(`${date} is added more than once.`);
  }
  return errors;
}
