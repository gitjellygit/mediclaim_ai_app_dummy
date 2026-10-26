export function humanizeEnum(value, fallback = "—") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function roleLabel(value) {
  return humanizeEnum(value, "Unknown Role");
}
