# HIPAA-Ready Engineering Baseline for CLAIM APP

This document is an engineering checklist, not a certification, legal opinion, or evidence that a BAA exists.

## Current application safeguards

The current codebase includes:

- authenticated and organization-scoped claim, document, Journey, denial, underpayment, rule, and audit workflows;
- role-based controls for sensitive mutations;
- submitted/finalized claim locking;
- authenticated, tenant-scoped document preview/download paths;
- request/session audit context with PHI-safe metadata allowlisting;
- HttpOnly production refresh credentials, hashed refresh-token storage, token rotation/reuse detection, session revocation, and active-session validation;
- private document-storage support with production S3 enforcement and server-side encryption controls;
- BAA-gated external denial-LLM use with minimum-necessary, identifier-reduced prompts;
- production payer-connector hardening:
  - Stedi production is unavailable unless both `STEDI_PRODUCTION_API_KEY` and `STEDI_PRODUCTION_PHI_CONFIRMED=true` are configured;
  - the confirmation flag is a deployment safety interlock only and does not prove a BAA or HIPAA compliance;
  - Stedi test connector and its test payer directory are refused when `NODE_ENV=production`;
  - production payer-connector assignment is ADMIN-only;
  - external payer calls have a 15-second timeout;
  - upstream payer authentication/rate-limit/error messages are translated before reaching the browser;
  - 837 claim submission is generated from server-side claim data and LIVE claims are not marked submitted until the external connector accepts the transmission;
  - the Patient Control Number is persisted before external transmission so retries reuse the same correlation key and deterministic idempotency key;
  - 277/835 and 837 acknowledgment payloads do not retain full raw payer bodies or raw X12 in normal application persistence/response paths;
  - 835 discovery is correlated from the claim's stored Patient Control Number rather than a browser-supplied external transaction ID;
  - payer transaction uniqueness is scoped to upstream transaction + application claim, allowing one 835 transaction to adjudicate multiple claims.

### External payer scope

The current Stedi integration supports eligibility, 837P/837I claim
submission, production 276/277 claim status, and 835 remittance. A generic
prior-authorization submission/status transaction is intentionally not
advertised by the Stedi connector because the selected Stedi API surface does
not provide that workflow. Prior authorization requirement is captured from
eligibility/readiness; authorization itself remains payer-specific and must be
integrated with an approved payer/vendor API before it can be automated.

### Eligibility identity safeguards

Eligibility uses subscriber identity when the patient is a dependent:

- subscriber/member ID;
- subscriber name;
- subscriber DOB for SPOUSE/CHILD/OTHER relationships;
- patient DOB only when the patient is the subscriber.

Changes to payer/member/subscriber identity or DOB stale prior eligibility/prior-auth state and require re-verification.

### Audit export safety

CSV cells are neutralized when values begin with spreadsheet formula prefixes (`=`, `+`, `-`, `@`) before export.

### Test/development routes

Synthetic E2E fixture behavior must remain gated by `E2E_TEST_MODE=true` and ADMIN authorization. Stedi test connectivity must never be enabled in production.

## H8B-1 — RBAC & Tenant Isolation

### Status: VERIFIED

PR #39 merged after the full automated workflow completed successfully.

#### Organization Scoping (VERIFIED)

All tenant-owned resources are now scoped to `req.user.organizationId`:

- **Claims**: All claim routes use `where: { id, organizationId: orgId(req), deletedAt: null }`
- **Documents**: Document access is scoped through claim relationship: `where: { id, claim: { organizationId: req.user.organizationId, deletedAt: null } }`
- **Denials**: Denial cases scoped through claim organization
- **Underpayments**: Underpayment cases scoped through claim organization
- **Payer Transactions**: Scoped through claim organization
- **Audit Events**: All audit writes include `organizationId: req.user.organizationId`
- **Rules**: **FIXED** - Rules now have `organizationId` field and are scoped to caller's organization
- **Medical Consistency**: Summary and detail endpoints scoped to organization
- **Claim Journey**: Journey endpoints scoped to organization
- **File Download/Preview**: Document download verifies organization through claim relationship

#### RBAC (VERIFIED)

Role-based access control is enforced:

- **ADMIN**: Full operational access within own organization, including destructive actions (permanent purge, rule management)
- **CASHIER**: Claim/financial/document operational access within own organization, but no administrative/destructive actions
- **RECEPTIONIST**: Limited claim intake/read/update access, no submit/delete/purge/payment/admin actions

Role enforcement uses `requireRoles(["ADMIN"])` middleware for sensitive routes.

#### Tenant Isolation (VERIFIED)

Cross-tenant access is blocked for:

- GET operations on foreign organization resources
- PATCH/PUT operations on foreign organization resources
- POST actions on existing foreign resources
- DELETE operations on foreign organization resources
- Bulk operations (mixed-organization bulk delete returns 404)
- Nested resources (documents, denials, payments scoped through parent claim)
- Downloadable files (document download verifies claim organization)
- Payer transactions (scoped through claim)
- Denials/appeals (scoped through claim)
- Payments/remittances (scoped through claim)
- Medical consistency detail (scoped through claim)
- Rules (scoped by organizationId)

Foreign resources return 404 (not 403) to avoid existence leakage.

#### File Access (VERIFIED)

Document download/preview:

- Verifies document belongs to a claim in the same organization
- Does not serve files based only on document ID/path
- Maintains path traversal protections (`storedDocumentPath.js`)
- Keeps private-cache/security behavior intact (`Cache-Control: private, no-store`)

#### Medical Consistency (VERIFIED)

- List/summary only includes caller's organization claims
- Claim-level analysis cannot access foreign claim IDs
- Deep-link UX requires backend authorization (404 for foreign claims)

#### Audit / Admin Data (VERIFIED)

- Audit events scoped by organization
- All audit writes include `organizationId: req.user.organizationId`
- Audit log reads are scoped: `where: { organizationId: orgId(req), claimId }`

#### E2E / Dev Routes (VERIFIED)

E2E fixture routes (`/api/claims/e2e/*`) are protected:

- Only available when `E2E_TEST_MODE=true`
- Only accessible by ADMIN users
- Returns 404 for normal production runtime

#### Tests (VERIFIED)

Backend tests (`backend/tests/tenantIsolation.test.js`):

- Organization-scoped claims cannot be accessed by foreign org
- Organization-scoped documents cannot be accessed by foreign org
- Organization-scoped denial cases cannot be accessed by foreign org
- Organization-scoped rules cannot be accessed by foreign org
- Audit events are scoped to organization
- Underpayment cases are scoped through claim organization
- Payer transactions are scoped through claim organization
- Claim search is scoped to organization
- Medical consistency summary is scoped to organization
- Same code can exist in different organizations (composite unique constraint)

E2E tests (`frontend/tests/tenant-isolation.e2e.spec.js`):

- Mixed-organization bulk delete is rejected atomically
- Foreign claim cannot be read by different organization
- Foreign claim cannot be updated by different organization
- Foreign claim cannot be deleted by different organization
- Foreign document cannot be read by different organization
- Foreign document cannot be reprocessed by different organization
- Foreign document cannot be deleted by different organization
- Rules are scoped to organization
- Medical consistency detail is scoped to organization
- Claim journey is scoped to organization
- Claim audit log is scoped to organization

#### Files Changed

- `backend/prisma/schema.prisma`: Added `organizationId` to Rule model, composite unique constraint on `(organizationId, code)`
- `backend/prisma/migrations/20261005100000_add_rule_organization_scoping/migration.sql`: Migration to add organizationId to Rule
- `backend/src/routes/rules.js`: Updated all routes to scope by organization
- `backend/tests/tenantIsolation.test.js`: Comprehensive tenant isolation backend tests
- `frontend/tests/tenant-isolation.e2e.spec.js`: Expanded E2E tenant isolation tests

#### Migration Details

Migration `20261005100000_add_rule_organization_scoping`:

- Adds `organizationId` to Rule
- Rejects migration rather than guessing ownership if legacy rules exist but no Organization exists
- Snapshots legacy global rules and clones each definition to every existing organization
- Drops global uniqueness on `code`
- Adds composite uniqueness on `(organizationId, code)`
- Adds the Organization foreign key and `organizationId` index
- Does not create a synthetic/fake organization during migration
- Seed logic uses the composite organization/code key

#### Remaining Gaps

- H8B-1 covers application authorization and tenant isolation. Release approval must still consider sessions, audit breadth, storage/encryption, API/upload hardening, secrets/configuration, retention/recovery, infrastructure, vendor agreements, and operating procedures.

## H8B-2 — Session & Authentication Security

### Status: IN PROGRESS — implementation complete, CI/regression verification pending

Implemented in `hardening/hipaa-8b-2-session-security`:

- Refresh credentials move from browser-readable localStorage to an HttpOnly cookie.
- Refresh tokens are random opaque values; only SHA-256 hashes are stored in the database.
- Existing refresh sessions are intentionally invalidated by the migration so users re-authenticate under the hardened model.
- Refresh tokens rotate on every successful refresh; the previously used token is revoked.
- Access JWTs carry a session identifier (`sid`) and protected APIs verify that the backing session is still active.
- Single logout revokes the whole current session, invalidating both its refresh credential and already-issued access JWTs.
- Logout-all revokes all sessions for the authenticated user, including existing access JWTs.
- Active sessions track created/last-used time, user agent, and IP address.
- Authenticated users can list active sessions and revoke a selected session.
- Production refresh credentials are not accepted from JSON request bodies and are not returned in JSON responses.
- Cookie controls use HttpOnly, configurable SameSite, Secure in production, and a restricted `/api/auth` path.
- Credentialed CORS is enabled; production requires an explicit `CORS_ORIGIN`.
- Access JWTs must be `type=access`; legacy JWTs without a session ID are rejected in production.
- Existing login lockout/rate-limit behavior remains in place.

Regression coverage includes refresh rotation, hashed token storage, cookie flags, logout-all access-token invalidation, single-session logout invalidation, and legacy test compatibility.

Password reset is not currently implemented in this application. When that workflow is added, it must revoke all active sessions as part of the password-change transaction before H8B-2 can be considered complete for that future feature.

## Controls still required before production PHI use

### Governance / contracts
- Determine whether the organization is a Covered Entity, Business Associate, or subcontractor.
- Execute BAAs with every vendor that creates, receives, maintains or transmits ePHI as applicable.
- Complete formal HIPAA security risk analysis and documented risk-management plan.
- Define policies for access, incident response, breach notification, retention and workforce training.

### Identity and access
- Enterprise SSO/MFA.
- Strong password/secret policies.
- Least-privilege role matrix.
- Tenant/organization isolation if the product serves multiple customers.
- Periodic access reviews and immediate deprovisioning.

### Audit
- Expand AuditEvent coverage to login, claim read/view, claim edit, document preview/download/delete, exports and administrative actions.
- Make audit logs tamper-resistant with controlled retention.
- Add security monitoring and alerting.

### Data protection
- TLS everywhere.
- Encryption at rest for database, object storage, backups and logs.
- Private object storage; short-lived authorized links if used.
- Key-management and rotation policy.
- Encrypted backups and tested disaster recovery.
- File malware scanning.
- Upload size/type/content validation.

### Privacy
- Minimum-necessary access by role and workflow.
- Avoid PHI in application logs, analytics, crash reporting and support tickets.
- Establish retention/deletion policies consistent with customer/legal requirements.
- Review exports/downloads for minimum necessary data.

### Infrastructure
- Production network segmentation.
- Managed secrets store instead of .env files.
- Vulnerability scanning and patch management.
- Backup/restore drills.
- Incident response exercises.
- Availability and disaster-recovery controls.

### AI / LLM
- Use only an LLM/API configuration covered by the organization's BAA/healthcare agreement when processing PHI.
- Maintain model/provider/version audit metadata.
- Limit prompts to minimum-necessary fields.
- Ground recommendations in structured facts and payer data.
- Never allow model output to overwrite payer source-of-truth data automatically.
- Human review before appeal submission or financial adjustment.
- Evaluate hallucination, prompt-injection and data-leakage risks.
- Version prompts/rules/evaluations.
- Maintain an AI evaluation set for denial classifications and recommended actions.

## Product wording

Do not market the MVP as "HIPAA certified."

Prefer:
- "Designed to support HIPAA-compliant deployment"
- "HIPAA-ready security and audit controls"
- "BAA-gated LLM integration"
- "Minimum-necessary AI context"

Actual HIPAA compliance depends on the organization's complete administrative, physical and technical safeguards, contracts, deployment and operating practices.
