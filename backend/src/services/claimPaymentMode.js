export function isSelfPayClaim(claim) {
  const value = String(claim?.payerName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ["self pay", "selfpay", "patient pay", "patient responsibility"].includes(value);
}
