# Production Migration Rehearsal

This repository's CI applies all Prisma migrations to a fresh PostgreSQL database. That verifies migration syntax and clean-install compatibility, but it does **not** replace a rehearsal against representative existing data.

Before a production deployment that contains new migrations:

1. Create a sanitized copy, staging restore, or representative dataset shaped like production. Never point rehearsal commands at the live production database.
2. Back up the rehearsal database before applying migrations.
3. Set `DATABASE_URL` to the rehearsal database and record the source snapshot/version.
4. Run:

   ```bash
   cd backend
   npx prisma migrate status
   npx prisma migrate deploy
   npx prisma migrate status
   ```

5. Start the application against the rehearsed database and execute the automated backend/API regression suite appropriate to that environment.
6. Verify at minimum:
   - every Claim still belongs to the expected Organization;
   - payer transaction uniqueness remains scoped by transaction + claim;
   - organization-owned submitter/billing/legal configuration remains associated with the expected Organization;
   - existing claims, documents, service lines, payer transactions, denials, underpayments and audit events retain their counts and foreign-key relationships;
   - login/session and organization-scoped reads still work;
   - representative claim readiness, document access, payer status and remittance workflows can read migrated rows.
7. Record migration duration, database size, any locks/timeouts and the rollback/restore time.
8. Do not approve the production deployment if the rehearsal required manual data correction that is not encoded in a reviewed migration.

## Suggested integrity queries

Run equivalent checks appropriate to the target PostgreSQL environment:

```sql
-- Claims without a valid organization should be zero.
SELECT count(*)
FROM "Claim" c
LEFT JOIN "Organization" o ON o.id = c."organizationId"
WHERE o.id IS NULL;

-- Review organization-owned submission profile fields after migration.
SELECT id, slug, "stediSubmitterName", "stediBillingProviderName"
FROM "Organization"
ORDER BY slug;

-- Payer transaction duplicates under the scoped business key should be zero.
SELECT "transactionId", "claimId", count(*)
FROM "PayerTransaction"
GROUP BY "transactionId", "claimId"
HAVING count(*) > 1;
```

## Release evidence

Attach the rehearsal record to the release/PR or deployment ticket: snapshot date, migration list, before/after counts, integrity-query results, runtime, restore test result and reviewer approval.

A fresh-database CI pass is necessary but is not evidence that a production-shaped migration rehearsal occurred.
