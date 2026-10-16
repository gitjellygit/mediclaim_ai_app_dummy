# Rules Policy Engine

## Purpose

The Rules module is the deterministic policy layer used by claim readiness. It is intentionally separate from probabilistic AI/LLM analysis.

Rules are organization-scoped and must never execute arbitrary code. Admin-created rules use a controlled field/operator definition and can optionally be scoped to a payer.

## Rule categories

1. Patient & Coverage
   - member / subscriber identifiers
   - coverage and eligibility expectations
   - subscriber relationship and plan identifiers

2. Provider
   - billing/rendering/referring NPI
   - TIN and taxonomy
   - payer/provider enrollment prerequisites

3. Claim & 837
   - professional vs institutional claim requirements
   - claim filing/frequency controls
   - timely filing
   - external 837 connector prerequisites

4. Coding
   - structured diagnosis presence
   - verified CPT/HCPCS service lines
   - diagnosis-to-service-line linkage
   - claim/service-line code constraints

5. NCCI / MUE
   - CMS NCCI Procedure-to-Procedure edits
   - CMS Medically Unlikely Edits
   - versioned by published effective date
   - imported from authoritative source data rather than manually invented

6. Authorization
   - prior-authorization requirement
   - approval / authorization number expectations
   - payer-specific authorization policy extensions

7. Documentation
   - required supporting-document expectations
   - unresolved document-identity review
   - payer-specific evidence requirements

8. Financial
   - positive claim/line charges
   - billed/claimed amount expectations
   - contract/payment consistency extensions

9. Payer Policy
   - organization-admin rules limited to a payer name and/or payer EDI ID
   - contract-specific administrative requirements

10. Workflow
   - submission/review guardrails
   - state-transition prerequisites
   - future escalation and recovery workflow policy

## Governance

- Mandatory system safeguards cannot be disabled, deleted or downgraded.
- System-managed rules are implemented by deterministic server-side code.
- Custom rules use a safe JSON definition:
  - field
  - operator
  - expected value
  - optional appliesWhen predicate
- Custom rules can be versioned and have effective-from/effective-to dates.
- Deleting a custom rule is a soft archive, preserving auditability.
- Rule creates/updates/archives are written through the critical audit path.
- Rules are tenant-scoped by organization.

## External source adapters

### CMS NCCI PTP

Future import adapter for published CMS NCCI Procedure-to-Procedure edit files. Store source version/effective date and do not bundle proprietary CPT descriptors.

### CMS MUE

Future import adapter for publicly available CMS MUE values. Confidential MUE values must not be reconstructed or exposed.

### Payer policies

Payer policy imports should identify:
- payer / EDI ID
- source document or contract
- effective dates
- version
- rule owner
- approval state

Do not infer a payer rule from historical denials and silently activate it. Suggested rules should require human approval.

## Safe extension pattern

Add new fields only to the explicit rule field catalog. Add operators only when they have deterministic, bounded evaluation semantics.

Do not add:
- eval / Function
- arbitrary JavaScript expressions
- SQL snippets
- external URLs executed during readiness
- free-form regular expressions without bounded validation
- cross-tenant lookup rules

## Source-of-truth principle

The Rules module does not claim that a configured rule is a universal U.S. payer requirement. System rules should cite an implemented transaction/claim requirement. Payer and CMS datasets must retain their source/version/effective date so users can distinguish organization policy from authoritative external edits.
