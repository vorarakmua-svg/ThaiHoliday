import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { SourceResult } from '../schema.js';
import { ceYear } from '../rules/dates.js';
import { normaliseThai } from '../rules/names.js';

const execFileAsync = promisify(execFile);

export const PYTHON_HOLIDAYS_SOURCE = 'python-holidays' as const;

export const PYTHON_HOLIDAYS_URL = 'https://github.com/vacanza/holidays';

const Output = z.object({
  version: z.string(),
  holidays: z.array(z.object({ date: z.string(), name_th: z.string() })),
});

/**
 * python-holidays, the open-source holiday library, as a witness the watch can consult
 * without any network access beyond installing it.
 *
 * It is maintained independently of every other source here and tracks มติ ครม. by hand,
 * so it is a genuine second opinion — though it lags on fresh cabinet grants, which is why
 * BOT stays the witness for those. Like Google, it lists observances that fall on a
 * weekend; the watch only weighs its weekday entries.
 */
export function parsePythonHolidays(raw: string, yearBe: number): SourceResult {
  const output = Output.parse(JSON.parse(raw));
  const yearCe = ceYear(yearBe);
  const records = output.holidays
    .filter((row) => row.date.startsWith(`${yearCe}-`))
    .map((row) => ({ source: PYTHON_HOLIDAYS_SOURCE, date: row.date, name_th: normaliseThai(row.name_th) }));

  return {
    source: PYTHON_HOLIDAYS_SOURCE,
    url: `${PYTHON_HOLIDAYS_URL} (v${output.version})`,
    records,
    warnings: records.length === 0 ? [`python-holidays ${output.version} has no holidays for ${yearBe}.`] : [],
  };
}

/** Run scripts/python_holidays.py. Needs `pip install -r requirements-ci.txt`. */
export async function loadPythonHolidays(yearBe: number): Promise<SourceResult> {
  const python = process.env['PYTHON'] ?? 'python3';
  const { stdout } = await execFileAsync(python, ['scripts/python_holidays.py', String(yearBe)], {
    timeout: 60_000,
    encoding: 'utf8',
  });
  return parsePythonHolidays(stdout, yearBe);
}
