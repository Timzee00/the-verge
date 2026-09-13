# Finance & Business OS — Production Architecture

## Product identity
The product name is intentionally not fixed in this repository. UI copy uses **Finance OS** / **Business OS** as neutral internal labels until branding is decided.

## Core principles
1. **Local-first**: create/read/update operations happen locally first; internet is an accelerator for synchronization, not a prerequisite for core operations.
2. **Event-based inventory**: stock is derived from immutable inventory events rather than synchronizing a mutable `stock` number.
3. **Integer money**: amounts are stored as integer minor units (e.g. kobo) to avoid floating-point accounting errors.
4. **Idempotent synchronization**: every client operation has a unique operation ID and can be safely retried.
5. **Explicit conflict resolution**: the server never uses blind last-write-wins for financial or inventory facts.
6. **Permissions + entitlements**: subscription plan, feature entitlement, staff role and data scope are separate concepts.
7. **Deterministic financial truth**: calculations are performed by domain logic. AI/LLMs may explain/analyze through controlled tools but cannot be the source of truth.
8. **Auditability**: financial, stock, permission, payment, security and deletion-sensitive mutations have durable audit records.
9. **Portability**: users can export selected account data in documented, portable formats and import after validation.
10. **Privacy by design**: personal finance and business data remain logically separated; consent, retention and deletion workflows are versioned.

## Core domain hierarchy
`User → Personal Space` and `User → Organization → Locations → Operations`.

## Offline sync model
A client writes a domain record and a corresponding outbox operation in one local transaction. The sync worker retries with bounded exponential backoff. Server APIs must accept an operation ID as an idempotency key and return a deterministic outcome.

For inventory, a sale is an event with a negative quantity delta; a purchase/receipt is a positive delta; a sale void is a compensating positive event; an adjustment has an explicit signed delta. Conflicts are resolved against server-accepted event history and business policies, never by replacing a stock balance with a stale client snapshot.

## Deployment philosophy
- Keep environment secrets out of source control.
- Keep the application build reproducible with `npm run build`.
- Keep domain rules independently testable with `npm run test:domain`.
- Treat database migrations as versioned artifacts.
- Use feature flags/entitlements for commercial access instead of hard-coding user exceptions.
