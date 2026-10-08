/**
 * Parse "2569,2570" or "2560-2568". Anything else is an error rather than being skipped:
 * a typo such as "69" or a reversed range would otherwise select no years at all, and the
 * command would report success having done nothing.
 */
export function parseYearList(value: string | undefined, fallback: number[]): number[] {
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
