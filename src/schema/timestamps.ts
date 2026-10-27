const PG_TIMESTAMPTZ = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Normalizes PostgreSQL timestamptz text (`2026-10-03 22:27:19.883+00`,
 * as returned by string-mode columns) to ISO-8601 UTC for API transport.
 */
export function toIsoTimestamp(value: string): string {
  const match = PG_TIMESTAMPTZ.exec(value);
  if (!match) throw new TypeError(`Unrecognized timestamp format: ${value}`);
  const [, date, time, fraction = '0', zone = 'Z'] = match;
  const millis = fraction.padEnd(3, '0').slice(0, 3);
  const offset =
    zone === 'Z'
      ? 'Z'
      : zone.length === 3
        ? `${zone}:00`
        : zone.includes(':')
          ? zone
          : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const parsed = new Date(`${date}T${time}.${millis}${offset}`);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`Invalid timestamp: ${value}`);
  return parsed.toISOString();
}

export function toIsoTimestampOrNull(value: string | null): string | null {
  return value === null ? null : toIsoTimestamp(value);
}
