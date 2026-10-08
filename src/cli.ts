import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beYear, currentYearCe } from './rules/dates.js';
import { collectYear } from './collect.js';
import { buildSite, DATA_DIR, dataPath, listYears, readYear, writeYear } from './build.js';
import { diffYear, isEmpty, renderPullRequestBody, type YearDiff } from './diff.js';
import { validateParsed } from './validate.js';
import { loadOverride } from './overrides.js';
import { compareYear, renderWatchReport, type WatchFinding } from './watch.js';
import { fetchBotHtml } from './sources/bot-html.js';
import { fetchGoogleIcs } from './sources/google-ics.js';
import type { SourceResult } from './schema.js';

function currentYearBe(): number {
  return beYear(currentYearCe());
}

/**
 * Parse "2569,2570" or "2560-2568". Anything else is an error rather than being skipped:
 * a typo such as "69" or a reversed range would otherwise select no years at all, and the
 * command would report success having done nothing.
 */
function parseYearList(value: string | undefined, fallback: number[]): number[] {
  if (value === undefined) return fallback;
  const years = new Set<number>();
  for (const raw of value.split(',')) {
    const part = raw.trim();
    const range = /^(\d{4})-(\d{4})$/.exec(part);
    if (range && Number(range[1]) <= Number(range[2])) {
      for (let y = Number(range[1]); y <= Number(range[2]); y += 1) years.add(y);
    } else if (/^\d{4}$/.test(part)) {
      years.add(Number(part));
    } else {
      throw new Error(`Cannot read "${part}" as a Buddhist year or range, e.g. 2569 or 2560-2568.`);
    }
  }
  return [...years].sort((a, b) => a - b);
}

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/**
 * Re-collect the years that can still change and report what moved.
 *
 * Frozen years are skipped: once ครม. has been and gone, a settled year should never be
 * quietly rewritten by a source that changed its markup.
 */
async function refresh(args: string[]): Promise<number> {
  const dryRun = flag(args, 'dry-run');
  const thisYear = currentYearBe();
  const years = parseYearList(option(args, 'years'), [thisYear, thisYear + 1]);

  const diffs: YearDiff[] = [];
  const warnings = new Map<number, string[]>();

  for (const yearBe of years) {
    const existing = readYear(yearBe);
    if (existing?.frozen) {
      console.error(`พ.ศ. ${yearBe} is frozen; skipping.`);
      continue;
    }

    console.error(`Collecting พ.ศ. ${yearBe} ...`);
    const collected = await collectYear(yearBe, { requirePrimary: true });

    // Ignore the timestamp when comparing, or every run would look like a change.
    const comparable = { ...collected, generated_at: existing?.generated_at ?? collected.generated_at };
    const diff = diffYear(existing, comparable);
    diffs.push(diff);
    warnings.set(yearBe, collected.warnings);

    if (isEmpty(diff)) {
      console.error(`  no changes for ${yearBe}`);
      continue;
    }
    console.error(
      `  ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed`,
    );
    if (!dryRun) writeYear(collected);
  }

  const changed = diffs.filter((d) => !isEmpty(d));
  const body = renderPullRequestBody(diffs, warnings);

  const bodyFile = option(args, 'body-file');
  if (bodyFile) writeFileSync(bodyFile, `${body}\n`, 'utf8');
  else console.log(body);

  const summaryFile = process.env['GITHUB_OUTPUT'];
  if (summaryFile) {
    const cabinet = changed.some((d) => d.cabinetChange);
    writeFileSync(
      summaryFile,
      `changed=${changed.length > 0}\ncabinet_change=${cabinet}\nyears=${changed.map((d) => d.yearBe).join(' ')}\n`,
      { flag: 'a' },
    );
  }

  return 0;
}

/**
 * Compare the sources reachable from CI against the committed data.
 *
 * Writes nothing and never rebuilds a year — it only reports what the Bank of Thailand and
 * Google know that this repository does not, so a new มติ ครม. surfaces even where MyHora
 * is blocked.
 */
async function watch(args: string[]): Promise<number> {
  const thisYear = currentYearBe();
  const years = parseYearList(option(args, 'years'), [thisYear, thisYear + 1]);
  const findings: WatchFinding[] = [];
  // A watchdog that cannot see is worse than none: it reports a quiet day every day. If BOT,
  // the only witness for cabinet grants, cannot be read, the run fails so someone notices.
  let botMissed = false;

  for (const yearBe of years) {
    const committed = readYear(yearBe);
    if (!committed) {
      console.error(`No committed data for พ.ศ. ${yearBe}; skipping.`);
      continue;
    }

    const reachable: SourceResult[] = [];
    for (const [label, load] of [
      ['bot-html', () => fetchBotHtml(yearBe)],
      ['google-ics', () => fetchGoogleIcs(yearBe)],
    ] as const) {
      try {
        reachable.push(await load());
      } catch (error) {
        if (label === 'bot-html') botMissed = true;
        console.error(`  ${label} unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (reachable.length === 0) {
      console.error(`No sources were reachable for ${yearBe}.`);
      continue;
    }

    const yearFindings = compareYear(committed, reachable);
    console.error(`พ.ศ. ${yearBe}: ${yearFindings.length} finding(s)`);
    findings.push(...yearFindings);
  }

  const bodyFile = option(args, 'body-file');
  if (findings.length > 0) {
    const report = renderWatchReport(findings);
    if (bodyFile) writeFileSync(bodyFile, `${report}\n`, 'utf8');
    else console.log(report);
  }

  const summaryFile = process.env['GITHUB_OUTPUT'];
  if (summaryFile) {
    writeFileSync(
      summaryFile,
      `findings=${findings.length > 0}\ncabinet=${findings.some((f) => f.severity === 'cabinet')}\ncount=${findings.length}\n`,
      { flag: 'a' },
    );
  }

  if (botMissed) {
    console.error(
      'The Bank of Thailand page could not be read, so a new มติ ครม. would go unnoticed. ' +
        'Failing so the outage is visible.',
    );
    return 1;
  }
  return 0;
}

/** Collect one year live and print it without writing anything. */
async function verify(args: string[]): Promise<number> {
  const yearBe = Number(args.find((a) => /^\d{4}$/.test(a)) ?? currentYearBe());
  const year = await collectYear(yearBe);
  const errors = validateParsed(year).errors;

  console.log(JSON.stringify(year, null, 2));
  for (const warning of year.warnings) console.error(`warning: ${warning}`);
  for (const error of errors) console.error(`error: ${error}`);
  return errors.length > 0 ? 1 : 0;
}

function validate(): number {
  const years = listYears();
  if (years.length === 0) {
    console.error(`No data files found in ${DATA_DIR}/.`);
    return 1;
  }

  let failed = 0;
  for (const yearBe of years) {
    const raw = JSON.parse(readFileSync(dataPath(yearBe), 'utf8'));
    const { errors } = validateParsed(raw);
    if (errors.length === 0) {
      console.log(`ok    ${yearBe}`);
      continue;
    }
    failed += 1;
    console.log(`FAIL  ${yearBe}`);
    for (const error of errors) console.log(`      ${error}`);
  }

  console.log(`\n${years.length - failed}/${years.length} year files valid.`);
  return failed > 0 || !validateOverrides() ? 1 : 0;
}

/**
 * Overrides are only read during a refresh, which runs off CI. Without this a malformed
 * file would sit unnoticed until the next person tried to collect that year.
 */
function validateOverrides(root = join(DATA_DIR, 'overrides')): boolean {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return true;
  }

  let ok = true;
  for (const name of names.sort()) {
    if (name === 'README.md') continue;
    const match = /^(\d{4})\.yaml$/.exec(name);
    if (!match) {
      console.log(`FAIL  overrides/${name}`);
      console.log('      Not named <yearBe>.yaml, so the collector would never read it.');
      ok = false;
      continue;
    }
    try {
      loadOverride(Number(match[1]), root);
      console.log(`ok    overrides/${name}`);
    } catch (error) {
      console.log(`FAIL  overrides/${name}`);
      console.log(`      ${error instanceof Error ? error.message : String(error)}`);
      ok = false;
    }
  }
  return ok;
}

function build(): number {
  const result = buildSite();
  console.log(`Built ${result.years.length} years into public/v1 (${result.files.length} files).`);
  return 0;
}

/**
 * Mark years settled so the refresh bot stops proposing changes to them.
 *
 * Run this each January for the year just ended, once its ครม. record is complete. A
 * frozen year is never re-collected, and CI fails if its file changes.
 */
function freeze(args: string[]): number {
  const years = parseYearList(option(args, 'years'), args.filter((a) => /^\d{4}$/.test(a)).map(Number));
  if (years.length === 0) {
    console.error('Nothing to freeze. Pass years, e.g. freeze --years=2560-2568');
    return 1;
  }

  const current = currentYearBe();
  let failed = 0;
  for (const yearBe of years) {
    if (yearBe >= current) {
      console.error(`Refusing to freeze พ.ศ. ${yearBe}: it is not over yet.`);
      failed += 1;
      continue;
    }
    const year = readYear(yearBe);
    if (!year) {
      console.error(`No data file for พ.ศ. ${yearBe}.`);
      failed += 1;
      continue;
    }
    writeYear({ ...year, frozen: true });
    console.log(`froze ${yearBe}`);
  }
  return failed > 0 ? 1 : 0;
}

const USAGE = `Thai holiday collector

  refresh [--dry-run] [--years=2569,2570] [--body-file=PATH]
        Re-collect changeable years, write data/, and print a pull request body.
  verify [YEAR_BE]
        Collect one year live and print it. Writes nothing.
  watch [--years=...] [--body-file=PATH]
        Compare CI-reachable sources against committed data. Reports only; writes nothing.
  validate
        Check every file in data/ against the schema and the sanity rules.
  build
        Copy data/ into public/v1 for GitHub Pages.
  freeze --years=2560-2568
        Mark finished years settled so the refresh bot leaves them alone.
`;

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'refresh':
      return refresh(args);
    case 'verify':
      return verify(args);
    case 'watch':
      return watch(args);
    case 'validate':
      return validate();
    case 'build':
      return build();
    case 'freeze':
      return freeze(args);
    default:
      console.error(USAGE);
      return command === undefined || command === '--help' ? 0 : 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  },
);
