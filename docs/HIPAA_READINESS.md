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
