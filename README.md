# Claim AI MVP (v2) - Node + React + Postgres

> Development/demo application. Do not use real PHI or describe this build as
> production-ready until the deferred security/HIPAA gate is completed.

## Fresh local setup

### 1. Start PostgreSQL

From the project root:

```bash
docker compose up -d
```

### 2. Configure and start the backend

```bash
cd backend
cp .env.example .env
npm ci
npx prisma migrate dev
npx prisma generate
node prisma/seed.js
npm run dev
```

API: http://localhost:4000

The checked-in `.env.example` contains **local/demo-only** initial passwords:

- `admin@hospital.com` → `DEV_ADMIN_PASSWORD`
- `cashier@hospital.com` → `DEV_CASHIER_PASSWORD`
- `reception@hospital.com` → `DEV_RECEPTION_PASSWORD`

Change those values in your local `.env` if desired **before the first seed**.
The seed intentionally never overwrites an existing user's password. If your
database was already seeded with unknown/generated credentials, reset the local
database or use the approved account/password rotation flow rather than rerunning
the seed and expecting a password change.

When `NODE_ENV=test`, the Playwright-only synthetic accounts keep their fixed
test credentials so automated tests remain deterministic.

### 3. Start the frontend

```bash
cd frontend
npm ci
npm run dev
```

UI: http://localhost:5173

## Local testing

Backend:

```bash
cd backend
npm test
```

Frontend fast Playwright suite:

```bash
cd frontend
npm run test:e2e:fast
```

Synthetic E2E fixture routes require `E2E_TEST_MODE=true` and an ADMIN user.
Never enable those fixture endpoints in production.

## Current product areas

- Claim intake and claim detail
- Document upload, OCR/classification, duplicate detection and provenance
- Readiness/completeness and medical consistency
- Eligibility, prior authorization and Claim Journey
- Simulated payer/clearinghouse lifecycle
- Denial intelligence and appeal workflow
- Remittance and payment variance / underpayment recovery

## Security status

Foundational local-development controls are present, but the larger Section 8B
security/HIPAA gate is intentionally deferred and remains required before real
PHI, shared staging with PHI, or production use.
