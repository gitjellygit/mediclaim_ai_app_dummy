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

## Database/client preparation

After pulling schema changes, prepare the backend before starting it:

```bash
cd backend
npm run db:prepare
```

`npm run dev` now runs this preparation automatically. This regenerates the
Prisma client and applies committed migrations before the development server
starts. Production deployments should run `npm run db:prepare` as a release
step (or use `npm run start:prepared` for single-instance deployments) before
serving traffic.

## Production payer safety

Real payer connectivity is fail-closed.

For Stedi production, both of these must be configured:

```env
STEDI_PRODUCTION_API_KEY=<secret>
STEDI_PRODUCTION_PHI_CONFIRMED=true
```

`STEDI_PRODUCTION_PHI_CONFIRMED` is an application safety interlock confirming that the deployment has explicitly approved PHI transmission to the configured Stedi account. It is **not** proof of a BAA, HIPAA compliance, or legal approval.

Additional safeguards:

- Stedi test connectivity and the test payer directory are refused when `NODE_ENV=production`.
- Only ADMIN users can attach/change an external payer connector on a claim.
- External payer calls time out after 15 seconds.
- 270/271, 276/277, and 835 application records store normalized minimum-necessary results rather than full raw payer responses/X12.
- Browser-triggered ERA refresh uses the claim's persisted Patient Control Number; callers cannot request an arbitrary external Stedi transaction.
- One upstream 835 can be associated with multiple application claims; idempotency is enforced per transaction + claim.
- Dependent eligibility requires subscriber identity, including subscriber DOB rather than reusing the patient's DOB.

Do not enable production payer connectivity until vendor agreements/BAAs, deployment security review, access controls, logging, retention, incident response, and other applicable compliance requirements are approved.

## Code quality commands

Both backend and frontend expose:

```bash
npm run lint
npm run format:check
npm run format
```

The repository intentionally does not mass-reformat existing code as part of production-hardening changes; formatting can be applied in isolated cleanup commits to keep functional reviews readable.
