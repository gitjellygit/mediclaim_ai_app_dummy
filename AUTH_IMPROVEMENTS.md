# Authentication & Authorization — Current Engineering Baseline

This document describes the authentication behavior implemented in CLAIM APP. It is an engineering reference, not a security certification.

## Current session model

- Access tokens are JWTs and default to a 15-minute lifetime.
- Production access JWTs must contain a valid session ID (`sid`) and `type=access`.
- Refresh credentials are random opaque tokens.
- Only SHA-256 hashes of refresh credentials are stored in the database.
- In production the refresh credential is carried in an HttpOnly cookie and is not accepted from a JSON request body.
- The refresh cookie is scoped to `/api/auth`, is Secure in production, and uses configurable SameSite behavior.
- Successful refresh rotates the refresh credential while preserving the logical session.
- Reuse of a revoked refresh credential revokes the entire session.
- Logout revokes the current session.
- Logout-all revokes all active sessions for the user.
- Users can list active sessions and revoke an individual session.
- Protected API requests validate that the JWT's backing session is still active.

Local/test compatibility may return or accept a refresh token in JSON. Production intentionally does not.

## Frontend behavior

The API client:

- stores the short-lived access token in browser localStorage;
- never stores the production refresh credential in JavaScript-accessible storage;
- proactively calls the refresh endpoint when an access token is missing/near expiry;
- retries a protected request once after an application 401 by attempting session refresh;
- sends requests with `credentials: "include"` so the HttpOnly refresh cookie can be used;
- clears local access state and redirects to login when refresh/retry cannot recover the session.

Authentication endpoints themselves are excluded from automatic protected-request refresh behavior so, for example, an invalid login is not confused with an expired application session.

## Account protections

- bcrypt password verification;
- failed-login tracking;
- account lockout after five failed attempts;
- login rate limiting;
- short-lived access JWTs;
- refresh-token rotation and reuse detection;
- session revocation;
- role-based route authorization with `requireRoles`;
- organization/tenant claims embedded in the authenticated identity and enforced by resource routes;
- auth/session audit events.

The current in-process login rate limiter is application-instance local. A horizontally scaled production deployment should use a shared rate-limit store or equivalent edge control.

## Roles

Current application roles include ADMIN, CASHIER, and RECEPTIONIST.

Sensitive operations must use explicit route-level authorization. In particular, production payer-connector assignment is ADMIN-only. Resource access must also remain organization-scoped; a role check is not a substitute for tenant isolation.

## Key endpoints

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `GET /api/auth/me`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:sessionId`

The development lockout-reset route is unavailable in production.

## Required production configuration

At minimum:

```env
JWT_SECRET=<strong secret managed outside source control>
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
CORS_ORIGIN=https://your-approved-ui-origin.example
REFRESH_COOKIE_SECURE=true
REFRESH_COOKIE_SAME_SITE=lax
```

Production secrets should be supplied by the deployment secret manager rather than committed .env files.

## Known security work outside this auth module

Authentication alone does not make the product production/HIPAA compliant. Production release review must also cover infrastructure, MFA/SSO strategy, secrets/key rotation, monitoring, malware scanning, backup/restore, incident response, access reviews, vendor agreements/BAAs, and the technical controls documented in `docs/HIPAA_READINESS.md`.

Do not describe this application as "production-ready" or "HIPAA certified" solely because these authentication controls are present.
