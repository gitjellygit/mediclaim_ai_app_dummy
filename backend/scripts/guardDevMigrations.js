import "dotenv/config";
import process from "node:process";

function isLocalDatabaseUrl(raw) {
  try {
    const url = new URL(raw);
    const host = String(url.hostname || "").toLowerCase();
    return ["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
}

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const override =
  String(process.env.ALLOW_NONLOCAL_DEV_MIGRATIONS || "").toLowerCase() === "true";

if (!databaseUrl) {
  console.error("DATABASE_URL is required before running development migrations.");
  process.exit(1);
}

if (!isLocalDatabaseUrl(databaseUrl) && !override) {
  console.error(
    [
      "Refusing to apply development-startup migrations to a non-local database.",
      "Run migrations through the deployment process instead.",
      "If this is an intentional development environment, set",
      "ALLOW_NONLOCAL_DEV_MIGRATIONS=true explicitly for this command."
    ].join(" ")
  );
  process.exit(1);
}
