/**
 * Minimal iCalendar reader — just enough for the two all-day holiday feeds this project
 * consumes. Pulling in a full RFC 5545 library would be more surface than the job needs.
 */

export interface IcsEvent {
  /** ISO date from DTSTART;VALUE=DATE. */
  date: string;
  summary: string;
  description: string;
}

/**
 * Undo RFC 5545 line folding: a line beginning with a space or tab continues the one
 * before it. Google folds long Thai holiday names mid-word, so failing to unfold would
 * truncate names and split them across records.
 */
function unfold(raw: string): string[] {
  const lines: string[] = [];
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

export function parseIcs(raw: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> | null = null;

  for (const line of unfold(raw)) {
    if (line.startsWith('BEGIN:VEVENT')) {
      current = {};
      continue;
    }
    if (line.startsWith('END:VEVENT')) {
      if (current?.date && current.summary) {
        events.push({
          date: current.date,
          summary: current.summary,
          description: current.description ?? '',
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);

    if (name.startsWith('DTSTART')) {
      // All-day events use DTSTART;VALUE=DATE:YYYYMMDD. Timed events are not holidays.
      const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
      if (match) current.date = `${match[1]}-${match[2]}-${match[3]}`;
    } else if (name === 'SUMMARY' || name.startsWith('SUMMARY;')) {
      current.summary = unescapeText(value).trim();
    } else if (name === 'DESCRIPTION' || name.startsWith('DESCRIPTION;')) {
      current.description = unescapeText(value).trim();
    }
  }

  return events;
}
