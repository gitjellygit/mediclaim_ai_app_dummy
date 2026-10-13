# Revenue Recovery: U.S. Security & HIPAA Readiness

This module is engineered to reduce later security rework, but application code alone does not establish HIPAA compliance.

## Controls implemented in this module

- Dedicated `RECOVERY_VIEW` permission for least-privilege access.
- Existing `RECOVERY_EDIT` / `DENIAL_EDIT` mutation permissions remain authoritative.
- Every recovery query is scoped to the authenticated user's organization.
- The unified queue returns minimum-necessary workflow data only:
  - patient name
  - payer
  - payer claim reference
  - recovery type/status
  - root cause
  - recovery dollars
  - appeal deadline
  - priority/next action
- Detailed documents and clinical data remain behind their existing permission-controlled workflows.
- Recovery list access is audit logged.
- Audit metadata does not store search text, patient names, or other PHI.
- New Revenue Recovery aggregation does not call an external LLM or AI service.
- Recovery Priority is deterministic and explainable; it is not represented as a probability.
- Unexpected API errors use the central sanitized error handler and do not expose database internals.

## Production gates before U.S. ePHI go-live

These must be completed and documented outside this feature before a HIPAA-regulated deployment:

1. Execute BAAs with every vendor/subprocessor that creates, receives, maintains, or transmits ePHI.
2. Complete and maintain the HIPAA Security Rule risk analysis and risk-management plan.
3. Enforce production MFA/SSO and appropriate session/access lifecycle controls.
4. Encrypt ePHI in transit and at rest with production key-management and rotation procedures.
5. Store secrets in an approved secrets manager; never in source or container images.
6. Establish workforce access policies, periodic access reviews, and termination/offboarding procedures.
7. Define audit-log retention, monitoring, alerting, and review responsibilities.
8. Establish tested backup, restore, disaster-recovery, and availability procedures.
9. Establish security-incident and breach-response procedures with contractual notification timelines.
10. Define data retention, deletion, export, and customer termination procedures.
11. Approve any external AI/LLM use for PHI only after security review, data-flow review, contractual/BAA coverage, retention controls, and minimum-necessary analysis.
12. Perform production penetration testing and vulnerability-management processes.
13. Review applicable state privacy/security laws and customer contractual requirements in addition to HIPAA.

## Design rule

Do not add PHI to logs, analytics telemetry, prompts, exception messages, or third-party services merely because it is convenient. Recovery workflows should use the minimum data necessary for the operational task.

## Regulatory note

The current HIPAA Security Rule remains the baseline. HHS published proposed Security Rule modifications in January 2025; proposed requirements should be tracked, but should not be treated as final law until finalized.
