import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HolidayYear } from './schema.js';

export const DATA_DIR = 'data';
export const PUBLIC_DIR = join('public', 'v1');

export function dataPath(yearBe: number, root = DATA_DIR): string {
  return join(root, `${yearBe}.json`);
}

export function readYear(yearBe: number, root = DATA_DIR): HolidayYear | null {
  try {
    return HolidayYear.parse(JSON.parse(readFileSync(dataPath(yearBe, root), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function writeYear(year: HolidayYear, root = DATA_DIR): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(dataPath(year.year_be, root), `${JSON.stringify(year, null, 2)}\n`, 'utf8');
}

export function listYears(root = DATA_DIR): number[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .map((name) => /^(\d{4})\.json$/.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

export interface BuildResult {
  years: number[];
  files: string[];
}

/**
 * Copy the reviewed data files into the directory GitHub Pages serves.
 *
 * Each year is written twice, once under its Buddhist year and once under the Gregorian
 * one. Thai holiday sources are published in พ.ศ. while most consuming code counts in CE,
 * and guessing wrong is an off-by-543 bug that looks like an empty result.
 */
export function buildSite(dataRoot = DATA_DIR, outDir = PUBLIC_DIR): BuildResult {
  const holidaysDir = join(outDir, 'holidays');
  // Start clean, so a year deleted or renamed in data/ is not still served from a
  // previous build.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(holidaysDir, { recursive: true });

  const years: number[] = [];
  const files: string[] = [];
  const index: Record<string, unknown>[] = [];

  for (const yearBe of listYears(dataRoot)) {
    const year = readYear(yearBe, dataRoot);
    if (!year) continue;
    years.push(yearBe);

    const body = `${JSON.stringify(year, null, 2)}\n`;
    for (const name of [`${year.year_be}.json`, `${year.year}.json`]) {
      const path = join(holidaysDir, name);
      writeFileSync(path, body, 'utf8');
      files.push(path);
    }

    index.push({
      year: year.year,
      year_be: year.year_be,
      status: year.status,
      frozen: year.frozen,
      holidays: year.holidays.length,
      days_off: year.holidays.filter((h) => h.is_day_off).length,
      warnings: year.warnings.length,
      url: `holidays/${year.year_be}.json`,
      url_ce: `holidays/${year.year}.json`,
    });
  }

  const indexPath = join(outDir, 'index.json');
  writeFileSync(
    indexPath,
    `${JSON.stringify(
      {
        name: 'Thai government holidays (วันหยุดราชการไทย)',
        generated_at: new Date().toISOString(),
        note: 'A year with status "provisional" has not yet been ratified by มติคณะรัฐมนตรี.',
        years: index,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  files.push(indexPath);

  return { years, files };
}
