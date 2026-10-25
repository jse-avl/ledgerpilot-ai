import { createDatabase } from "./client";
import { seed } from "./seed";

/**
 * Dev-only destructive reset. Refuses to run against a non-local Postgres
 * unless FORCE_RESET=1 is set, because a portfolio demo should never be one
 * typo away from wiping a real database.
 */
const url = process.env.DATABASE_URL;
if (url && !/localhost|127\.0\.0\.1|neon\.tech/.test(url) && process.env.FORCE_RESET !== "1") {
  console.error(
    "Refusing to reset a non-local database. Set FORCE_RESET=1 if you really mean it.",
  );
  process.exit(1);
}

const handle = await createDatabase();
try {
  console.log("Resetting demo data...");
  const result = await seed(handle, { reset: true });
  console.log(
    `Reset complete. ${result.tenants} tenants, ${result.invoices} invoices, ` +
      `${result.discrepancies} discrepancies.`,
  );
} finally {
  await handle.close();
}
