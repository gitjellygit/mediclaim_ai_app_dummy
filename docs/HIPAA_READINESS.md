# HIPAA-Ready Engineering Baseline for CLAIM APP

This document is an engineering checklist, not a certification or legal opinion.

## Controls already implemented in the current MVP

- JWT-protected claims, journey, documents, denial and rules routes.
- Role-based controls for sensitive operations.
- Submitted claims locked against normal edits/deletes.
- Denial/appeal mutations limited to ADMIN/CASHIER.
- Public document route removed.
- Debug endpoint restricted to authenticated ADMIN and returns counts only.
- Denial workflow writes AuditEvent records for create/update/AI actions.
- Denial/AI logs avoid patient name, member ID, policy number, authorization number and payer free-text reason.
- External denial LLM calls disabled unless HIPAA_BAA_CONFIRMED=true and model/key are configured.
- External LLM prompt excludes direct identifiers by design.
- AI output is labeled with provider/model and whether LLM was actually used.
- Rule-engine fallback keeps the application functional if the LLM fails.

## H8B-1 — RBAC & Tenant Isolation

### Status: VERIFIED

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

- Adds `organizationId` column to Rule table with default value
- Drops old unique constraint on `code` alone
- Adds composite unique constraint on `(organizationId, code)`
- Adds foreign key constraint to Organization
- Adds index on `organizationId`
- Existing rules assigned to default organization; requires data migration for production

#### Remaining Gaps

None identified for H8B-1 scope. All tenant-owned resources are properly scoped and tested.

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
