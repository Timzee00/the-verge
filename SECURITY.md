# THE VERGE security baseline

- No secrets belong in source code or browser bundles.
- Financial amounts use integer minor units.
- Inventory events are append-only; corrections use compensating events.
- Server-side inventory balance projections may be rebuilt from the immutable event ledger.
- Sync writes require deterministic device sequence numbers and idempotent server handling.
- Business data is scoped by organization and location on the server.
- Platform administration is separated from normal business roles.
- Sensitive admin, payment, entitlement, credential, deletion and recovery actions require audit records.
- API credentials are organization-bound, scoped, expiring/revocable and stored as hashes.
- Browser write endpoints using cookie authentication enforce same-origin requests.
- Session tokens are stored only as hashes server-side and presented as HttpOnly SameSite cookies.
- Password-reset tokens are one-time, hashed at rest, expire quickly, return non-enumerating request responses and revoke existing sessions when consumed.
- Public onboarding must not be enabled until account-security email delivery is configured.
- Consent categories remain independent; marketing consent is never bundled with necessary functionality.
- Account export is versioned and validated before import.

## Required production testing

Test another user, another organization, another location, insufficient role, unauthenticated requests, replayed operations, duplicated operations, expired/revoked API credentials, oversized batches and concurrent final-stock sales. Security controls must be proven by negative tests rather than inferred from the UI.
