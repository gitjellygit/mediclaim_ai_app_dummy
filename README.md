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

Section 8B hardening includes tenant isolation/RBAC, hardened sessions,
PHI-safe audit logging, transactional workflow protections, document provenance,
and secure document-storage support.

Local development/test may use `DOCUMENT_STORAGE_BACKEND=local`. Production
startup requires `DOCUMENT_STORAGE_BACKEND=s3`, `DOCUMENT_S3_BUCKET`, and
`AWS_REGION`. Document objects are written with server-side encryption
(SSE-KMS when `DOCUMENT_S3_KMS_KEY_ID` is configured; otherwise S3-managed
AES256) and are delivered through authenticated application routes rather than
public object URLs.

Production infrastructure must keep the document bucket private (S3 Block
Public Access / equivalent bucket policy), restrict IAM permissions to the
application role, enable appropriate encryption/key policies, logging,
retention/backup controls, and complete the deployment/compliance review before
real PHI is used. Engineering controls support HIPAA readiness but do not by
themselves constitute HIPAA certification.
