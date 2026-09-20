# THE VERGE — production-candidate status

## Current branch

- Branch: `offline-foundation-1.1`
- Pull request: #1 (draft)
- Backend target: Neon PostgreSQL
- Hosting target: Vercel
- Frontend: Vite + React
- Local data: IndexedDB via Dexie
- Product identity: **THE VERGE — Powered by Timzee Corp**

## Implemented in this branch

### Product and UX
- Public marketing site appears before authentication.
- Responsive workspace shell for smaller screens.
- Branded notification banners replace raw application errors in the UI.
- Hardcoded Lagos/Ikeja demo workspace references were removed from the live workspace.
- Marketing dashboard values are explicitly labeled illustrative.

### Authentication and session security
- Server-backed registration, login, session lookup, and logout.
- HttpOnly SameSite session cookie.
- Password hashing remains server-side.
- Login failure rate limiting.
- Cross-origin browser-write protection for authenticated sync/logout requests.
- API responses use no-store headers and avoid returning internal database errors.

### Local data isolation
- Personal finance records now carry a user namespace.
- Dexie personal indexes include `userId`.
- Logout clears the active personal-data view without deleting offline records.
- Account export filters user-owned personal sections by signed-in user.

### Sync and multi-location safety
- Stable server-side sync change sequence with a high-water-mark cutoff.
- Pagination uses a fixed cutoff so newly arriving changes do not invalidate an active pull.
- Location-scoped membership foundation.
- Server rejects writes to locations outside the user's assigned scope.
- Organization suspension is checked on sync reads/writes.
- Inventory direction semantics are validated on the server and in database triggers.
- Sale stock checks are protected by PostgreSQL transaction locks.
- Sale totals, discounts, cost, and below-cost status are reconstructed/verified server-side.
- Sale inventory events are bound to their sale items.
- Expanded sync payload includes sales items, customers, and expenses.
- Neon BIGINT/NUMERIC values are normalized at the pull API boundary.

### Audit and API foundation
- Sync-created products, customers, expenses, inventory events, and sales are written to the audit trail.
- Sequenced change-feed records are created for syncable entities.
- Scoped, expiring, revocable API credential management is present in Settings.
- API secrets are returned only at creation and stored as hashes.

### Financial correctness
- Money remains integer minor-unit based.
- Sale calculations now support fractional quantities up to six decimal places with deterministic line rounding.
- Below-cost sales require a reason.
- Journal balance validation remains part of the domain test suite.

## Verification status

### Verified from repository/tool inspection
- The branch contains the above source changes.
- The current Neon database was queried read-only and **does not yet contain** the new migration-003 tables:
  - `membership_locations`
  - `sync_changes`
  - `auth_rate_limits`
  - `api_credentials`

### Not yet proven
- Full Vite/TypeScript production build on the current branch.
- Full API TypeScript compilation in GitHub Actions.
- Browser-level offline/PWA smoke testing.
- Production database migration execution.
- Live Vercel deployment to a clean production alias.
- Real device concurrency testing across multiple locations.

## Current gating issue

Migration `db/migrations/003_production_hardening.sql` must be applied to the Neon database before the new location-scoping, sync-change feed, auth throttling, and API-credential code can operate.

The database migration has **not** been applied automatically.

## Merge gate

Do not merge PR #1 into `main` until all of these are green:

1. Frontend typecheck.
2. API typecheck.
3. Domain tests.
4. Full Vite build.
5. Preview deployment.
6. Registration/login smoke test.
7. Cross-location authorization test.
8. Offline create/sync/reconnect test.
9. Duplicate operation/idempotency test.
10. Below-cost sale validation test.
11. Mobile layout smoke test.
12. Database migration verification.

A Vercel deployment URL generated for a preview is not the same thing as the final production domain.
