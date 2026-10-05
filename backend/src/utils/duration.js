const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000
};

export function durationToMs(value, fallbackMs) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value * 1000;
  }

  const text = String(value || "").trim().toLowerCase();
  const match = text.match(/^(\d+)(s|m|h|d)$/);
  if (match) {
    const amount = Number(match[1]);
    return amount > 0 ? amount * UNIT_MS[match[2]] : fallbackMs;
  }

  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return seconds > 0 ? seconds * 1000 : fallbackMs;
  }

  return fallbackMs;
}
