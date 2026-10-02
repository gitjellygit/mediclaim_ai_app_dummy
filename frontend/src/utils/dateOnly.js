export function toDateInputValue(value) {
  if (!value) return "";

  if (typeof value === "string") {
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    const usMatch = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(value.trim());
    if (usMatch) {
      return `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
    }
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = String(value.getUTCFullYear()).padStart(4, "0");
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return "";
}

export function formatUSDateOnly(value, fallback = "—") {
  const iso = toDateInputValue(value);
  if (!iso) return fallback;
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}
