import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { HolidayStatus, HolidayType } from './schema.js';

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
    .nullable()
    .optional(),
  /** Why this override exists. Required so the file explains itself to the next reader. */
  note: z.string().min(1),
});

/**
 * Hand-written corrections, applied above every scraped source.
 *
 * This is the sanctioned route for anything the collector cannot reach on its own — most
 * importantly announcements published only on soc.go.th, which sits behind a Cloudflare
 * challenge and is deliberately not scraped.
 */
export const OverrideFile = z.object({
  /** Freeze a settled year so the refresh bot stops proposing changes to it. */
  frozen: z.boolean().optional(),
  /** Dates to introduce, or to enrich if a source already found them. */
  add: z.array(OverrideEntry).optional(),
  /** Dates to drop entirely, e.g. one a source reported in error. */
  remove: z
    .array(z.object({ date: z.string().regex(ISO_DATE), note: z.string().min(1) }))
    .optional(),
});

export type OverrideEntry = z.infer<typeof OverrideEntry>;
export type OverrideFile = z.infer<typeof OverrideFile>;

export function overridePath(yearBe: number, root = 'data/overrides'): string {
  return join(root, `${yearBe}.yaml`);
}

export function loadOverride(yearBe: number, root = 'data/overrides'): OverrideFile | null {
  const path = overridePath(yearBe, root);
  if (!existsSync(path)) return null;
  const parsed = yaml.load(readFileSync(path, 'utf8'));
  if (parsed === null || parsed === undefined) return null;
  return OverrideFile.parse(parsed);
}
