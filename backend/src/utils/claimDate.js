/**
 * Explicit parsing for optional US-facing date values. Reject impossible dates;
 * avoid JavaScript Date auto-normalizing invalid calendar values such as 02/31.
 * Date-only strings remain midnight UTC when persisted to legacy DateTime columns.
 */
export function parseClaimDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const input = String(value).trim();
  let year, month, day;
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(input);
  if (match) {
    [, year, month, day] = match;
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input);
    if (!match) return null;
    [, month, day, year] = match;
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) ||
      date.getUTCMonth() !== Number(month) - 1 ||
      date.getUTCDate() !== Number(day)) return null;
  return date;
}
