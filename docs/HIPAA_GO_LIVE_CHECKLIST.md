# HIPAA Go-Live Checklist

> Purpose: hard go-live gate for processing real U.S. PHI in CLAIM APP.
> This checklist is an engineering/compliance readiness aid, not legal advice.
> **Rule: if any item marked BLOCKER is unresolved, do not process production PHI.**

## Status legend

- ✅ Implemented / evidenced in repository
- 🟡 Verify in deployed AWS/account environment
- 🔴 BLOCKER before production PHI
- ⚪ Decision / owner required

---

## 1. Contracts and legal setup

| Status | Requirement | Evidence / action |
|---|---|---|
| 🔴 BLOCKER | Customer BAA | The legal entity operating CLAIM APP must have a HIPAA-compliant BAA with each covered entity / business associate customer before handling their PHI, where required. Assign legal owner and approved BAA template. |
| 🔴 BLOCKER | AWS BAA | Confirm an AWS Business Associate Addendum is accepted in AWS Artifact for the exact AWS account or AWS Organization that will process/store PHI. Save evidence of acceptance and scope. |
| 🔴 BLOCKER | AI-provider BAA | If OpenAI will receive PHI, execute the required OpenAI BAA and confirm the API organization is provisioned for HIPAA-eligible use / Modified Retention as applicable. If using Amazon Bedrock under the AWS BAA instead, document that decision and approved Bedrock models/services. |
| 🔴 BLOCKER | Subprocessor inventory | Maintain an approved list of every vendor/service that can create, receive, maintain, or transmit PHI (cloud, AI, OCR, email, clearinghouse, support tooling, monitoring, backups). Confirm BAA/subcontractor obligations where applicable. |
| ⚪ | Legal operating entity | Record the company/legal entity that signs customer BAAs and owns the production AWS/AI accounts. |
| ⚪ | Privacy/security contacts | Name HIPAA Privacy/Security responsible persons and escalation path. |

---

## 2. Current AI controls in the repository

| Status | Control | Current state |
|---|---|---|
| ✅ | External denial LLM disabled by default | `HIPAA_BAA_CONFIRMED=false` in `backend/.env.example`. |
| ✅ | BAA safety interlock | Denial LLM only enables when `HIPAA_BAA_CONFIRMED === "true"` and an API key/model are configured. |
| ✅ | Minimum-necessary LLM context | `denialIntelligence.js` excludes direct identifiers such as patient name, DOB, member ID, policy, phone, address and authorization number from the external LLM prompt. |
| ✅ | Deterministic fallback | Denial analysis falls back to local rule-based logic if the LLM is unavailable/disabled. |
| 🟡 | OpenAI HIPAA configuration | Must be verified in the actual production OpenAI organization before any PHI is sent. Repository flags alone are not evidence of a BAA. |
| ⚪ | Bedrock migration/selection | Decide whether production generative-AI traffic will use Amazon Bedrock instead of direct OpenAI. Bedrock may simplify the AWS/BAA architecture, but deployment still requires validation. |
| 🔴 BLOCKER | PHI inventory for every AI call | Review every current/future AI/OCR/vector-search call and document exactly which fields leave the application boundary and whether they contain PHI. |
| 🔴 BLOCKER | No raw PHI in AI logs | Confirm prompts/responses containing PHI are not written to application, model invocation, observability or error logs unless those stores are explicitly approved as PHI systems. |

---

## 3. AWS account and service configuration

| Status | Requirement | Current state / action |
|---|---|---|
| 🔴 BLOCKER | AWS BAA accepted | Verify in AWS Artifact. |
| 🔴 BLOCKER | HIPAA-eligible services only for PHI | Inventory production services and compare against the current AWS HIPAA Eligible Services Reference. |
| 🟡 | S3 production document storage | Repository enforces `DOCUMENT_STORAGE_BACKEND=s3` in production. |
| ✅ | S3 encryption supported | Document uploads use SSE-KMS when `DOCUMENT_S3_KMS_KEY_ID` is configured, otherwise S3-managed AES256. |
| 🔴 BLOCKER | Production KMS policy | Prefer and configure a customer-managed KMS key for PHI document storage; validate key policy, rotation and least privilege. |
| 🔴 BLOCKER | Database encryption | Confirm production RDS/database encryption at rest with approved KMS key and encrypted backups/snapshots. |
| 🔴 BLOCKER | TLS | Enforce HTTPS/TLS for browser, APIs, DB connections and all external integrations. |
| 🔴 BLOCKER | Secrets | Store production JWT secrets, EHR credentials, payer keys and AI credentials in AWS Secrets Manager or an equivalent approved secret store; do not rely on plaintext deployment env files. |
| 🔴 BLOCKER | Private networking | Put PHI-processing compute/databases in private networking where practical; evaluate VPC endpoints/PrivateLink for S3, Textract, Bedrock and other supported services. |
| 🔴 BLOCKER | CloudTrail / security monitoring | Enable CloudTrail and security monitoring with retention, alerting and restricted access. |
| 🟡 | WAF/rate limiting | App has API rate-limit controls; production WAF/API edge controls still require deployment verification. |
| 🔴 BLOCKER | Backups and DR | Define encrypted backups, tested restore procedure, retention, RPO/RTO and disaster-recovery owner. |

---

## 4. OCR / document processing

| Status | Requirement | Current state / action |
|---|---|---|
| ✅ | Textract used for OCR | Repository uses Amazon Textract for image/PDF OCR; Textract is HIPAA eligible when used under the AWS BAA and properly configured. |
| ✅ | Temporary Textract objects deleted | Temporary S3 objects used for asynchronous PDF OCR are deleted in a `finally` block. |
| 🔴 BLOCKER | Textract temporary-bucket encryption | `docIntel.js` currently uploads temporary PDF objects without explicitly setting SSE-KMS. Verify bucket default encryption or change code to enforce approved KMS encryption. |
| 🔴 BLOCKER | Textract bucket access | Restrict bucket access, block public access, apply least-privilege IAM and lifecycle controls. |
| 🟡 | Raw extracted text storage | Documents can store `rawText`; treat it as PHI and ensure DB encryption, access controls, retention and deletion cover it. |

---

## 5. Authentication, authorization and tenant isolation

| Status | Control | Current state / action |
|---|---|---|
| ✅ | Authenticated API | JWT access tokens with active-session validation exist. |
| ✅ | Session revocation | Production requests require active non-revoked sessions. |
| ✅ | Role/permission model | Fine-grained permissions exist for claims, clinical, financial, documents, integrations, audit, etc. |
| ✅ | PHI access-denied auditing | Permission denials write `PHI_ACCESS_DENIED` audit events. |
| ✅ | Organization scoping | Claims and integrations use `organizationId` scoping in repository queries. |
| 🔴 BLOCKER | Full tenant-isolation test | Perform automated cross-tenant authorization tests across every PHI endpoint, object download, EHR integration, search, export, payer flow and admin action. |
| 🔴 BLOCKER | MFA | Require MFA for privileged/administrative production access and define workforce access policy. |
| 🔴 BLOCKER | Developer production access | Define and enforce no-default developer PHI access, break-glass workflow and audit trail. |
| 🟡 | JWT secret quality | Env example requires >=32-char unique secret; production storage/rotation must be verified. |

---

## 6. Audit and logging

| Status | Control | Current state / action |
|---|---|---|
| ✅ | Application audit events | Audit events include organization, actor, claim/entity, action, outcome, IP, user-agent, method/path and request ID. |
| ✅ | Audit metadata allowlist | Audit metadata is sanitized through an explicit safe-key allowlist rather than dumping arbitrary objects. |
| 🔴 BLOCKER | Audit retention | Define retention, immutability/tamper resistance, access permissions and export procedure for production audit records. |
| 🔴 BLOCKER | Log PHI review | Search all production logging/error paths to ensure patient names, DOB, policy/member IDs, raw documents, prompts and claim payloads are not unintentionally logged. |
| 🔴 BLOCKER | Security alerts | Define alerts for repeated access denial, suspicious login/session behavior, admin changes, bulk export/download and integration failures. |

---

## 7. Data lifecycle and incident response

| Status | Requirement | Action |
|---|---|---|
| 🔴 BLOCKER | Data retention policy | Define retention by data class: claims, documents, audit events, integration payloads, backups, AI artifacts. |
| 🔴 BLOCKER | Secure deletion | Verify deletion/purge behavior across DB, S3, backups and downstream processors. |
| 🔴 BLOCKER | Breach/incident response plan | Document detection, containment, investigation, customer notification/legal escalation and evidence preservation. |
| 🔴 BLOCKER | Formal HIPAA security risk analysis | Complete and document a Security Rule risk analysis before production PHI. Track remediation owners/dates. |
| 🔴 BLOCKER | Workforce policies/training | Implement access, acceptable-use, incident and HIPAA/security training policies for people who can access PHI. |

---

## 8. Production AI decision

Choose and document one path before PHI go-live.

### Option A — Amazon Bedrock

- AWS BAA accepted for the production account/organization.
- Confirm Amazon Bedrock and every supporting AWS service used for the workload is HIPAA eligible.
- Use approved IAM/KMS/VPC configuration.
- Disable or tightly control model invocation logging if prompts can contain PHI.
- Document approved model IDs and regions.
- Maintain minimum-necessary prompt construction.

### Option B — OpenAI API

- AWS BAA still required for AWS infrastructure containing PHI.
- Execute OpenAI BAA for the production API organization.
- Confirm the organization is configured for HIPAA-eligible API use / Modified Retention as applicable.
- Limit application calls to HIPAA-eligible endpoints/features.
- Keep `HIPAA_BAA_CONFIRMED=false` until contractual and technical evidence is complete.
- Maintain minimum-necessary prompt construction.

---

## 9. Immediate actions / owners

| Priority | Action | Owner | Evidence required |
|---|---|---|---|
| P0 | Open AWS Artifact and verify/accept AWS BAA for production account/organization | Account owner | Screenshot/export/agreement status + covered account IDs |
| P0 | Identify legal entity that will contract with U.S. providers | Founder/Legal | Legal entity name |
| P0 | Obtain/review customer BAA template | Legal | Approved template |
| P0 | Decide Bedrock vs OpenAI for production PHI AI | Engineering/Security | Architecture decision record |
| P0 | If OpenAI: execute BAA and verify HIPAA API org configuration | Account owner/Legal | Executed BAA + org configuration evidence |
| P0 | Inventory all AWS/vendor services touching PHI | Engineering | Data-flow/subprocessor register |
| P0 | Fix/verify Textract temporary S3 encryption | Engineering | Code/config evidence |
| P0 | Verify RDS/S3/backups KMS encryption | Cloud/Security | AWS configuration evidence |
| P0 | Move production secrets into approved secret store | Cloud/Security | Secrets Manager/IAM evidence |
| P1 | Run full cross-tenant authorization test suite | Engineering/QA | Automated test report |
| P1 | Complete HIPAA security risk analysis | Security/Compliance | Signed risk analysis + remediation plan |
| P1 | Establish incident response + retention/deletion policies | Security/Legal | Approved policies |

---

## 10. Go-live decision rule

**Production PHI is NOT approved until all P0 / BLOCKER items above are resolved and evidence is stored.**

A green build, an AWS deployment, encryption, or a BAA by itself is not sufficient. HIPAA readiness requires the contractual chain, approved service configuration, technical safeguards, administrative safeguards and documented risk management to all be in place.
