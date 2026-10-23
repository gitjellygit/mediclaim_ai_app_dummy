# PRISM integration connectivity foundation

This layer provides reusable correlation and governance plumbing for future EHR, PMS, clearinghouse and payer adapters.

It is **not** a claim that PRISM currently has production integrations with a named EHR/PMS vendor.

## Guarantees

- Every connection is organization scoped.
- External claim identifiers are unique within one connection.
- External event IDs are idempotency keys within one connection.
- Events can correlate to a PRISM claim by registered external claim identity.
- A correlation conflict fails closed.
- The generic event endpoint accepts operational metadata only. It does not accept raw clinical or claim payloads.
- Event storage keeps a SHA-256 hash of normalized correlation metadata instead of a raw inbound payload.
- Connection creation, health changes, claim linking and event receipt are audit-visible.
- The current API is authenticated and requires PAYER_CONNECT. It is not a public webhook endpoint.

## Future vendor adapters

A vendor adapter should authenticate its webhook/API independently, transform the vendor message into the minimum necessary PRISM domain event, and only then call the integration service. Vendor secrets should be kept in the approved secrets manager rather than stored in these models.
