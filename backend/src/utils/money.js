/**
 * One exact boundary for monetary inputs and arithmetic.
 * API amounts remain decimal dollar numbers for backward-compatible UI.
 * Database stores Decimal(14,2); calculations work in integer cents.
 */
const MAX_CENTS = 99999999999999n;

export function moneyCents(value, { allowNegative = false } = {}) {
  if (value == null || value === "") throw new TypeError("Money value required");
  const str = String(value).trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(
    allowNegative && str.startsWith("-") ? str.slice(1) : str
  );
  if (!match) throw new TypeError("Money must have at most two decimal places");
  let cents = BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  if (cents > MAX_CENTS) throw new RangeError("Money amount is too large");
  if (str.startsWith("-")) {
    if (!allowNegative) throw new RangeError("Money cannot be negative");
    cents = -cents;
  }
  return cents;
}

export function moneyFromCents(cents) {
  const n = BigInt(cents);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const value = `${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
  return negative ? `-${value}` : value;
}

export function validMoney(value, options) {
  try { return moneyFromCents(moneyCents(value, options)); }
  catch { return null; }
}

export function numberMoney(value, options) {
  return Number(moneyFromCents(moneyCents(value, options)));
}

export function differenceMoney(a, b) {
  return Number(moneyFromCents(moneyCents(a) - moneyCents(b)));
}

export function percentageMoney(value, basisPoints) {
  const cents = moneyCents(value);
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
    throw new RangeError("Percentage basis points must be between 0 and 10000");
  }
  // Round half-up at the CENT level, not whole dollars.
  const rounded = (cents * BigInt(basisPoints) + 5000n) / 10000n;
  return Number(moneyFromCents(rounded));
}
