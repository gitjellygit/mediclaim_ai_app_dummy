/**
 * Parse a US-facing date-only value without relying on the JavaScript local timezone.
 *
 * Accepted inputs:
 * - YYYY-MM-DD
 * - MM/DD/YYYY
 * - MM-DD-YYYY
 * - the same ISO date with an optional time suffix
 *
 * Returned Date values are always midnight UTC so Prisma can safely write them to
 * PostgreSQL DATE columns without day shifts.
 */
export function parseClaimDate(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate()
    ));
  }

  const input = String(value).trim();
  let year;
  let month;
  let day;

  let match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(input);
  if (match) {
    [, year, month, day] = match;
  } else {
    match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(input);
    if (!match) return null;
    [, month, day, year] = match;
  }

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }

  return date;
}

export function toDateOnlyString(value) {
  const date = parseClaimDate(value);
  if (!date) return null;

  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatUSDateOnly(value) {
  const iso = toDateOnlyString(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}
