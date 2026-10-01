const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatUSD(value, fallback = "—") {
  if (value == null || value === "") return fallback;

  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;

  return USD_FORMATTER.format(amount);
}
