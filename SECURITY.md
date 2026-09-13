# The Verge security baseline

- No secrets belong in source code.
- Financial amounts use integer minor units.
- Critical inventory changes are modeled as events; last-write-wins is not an acceptable inventory strategy.
- Sync operations require idempotent server handling before production.
- Business data is scoped by organization and location.
- Platform administration must be separated from normal business roles.
- Sensitive admin, payment, entitlement and deletion actions require audit events.
- Consent categories are separate; marketing/newsletter consent is not bundled as a necessary cookie permission.
- Account export is versioned and validated before import.


## Pilot server controls

Authentication is server-backed. Session tokens are stored only as SHA-256 hashes in Neon and presented to the browser as HttpOnly cookies. Business synchronization endpoints verify active organization membership before accepting or returning organization data. Sync receipts enforce idempotency on device/local sequence and organization/entity identity.
