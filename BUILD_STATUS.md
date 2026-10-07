# THE VERGE — production hardening status

## Active recovery branch

- Branch: `production-hardening-1.2`
- Based on: `offline-foundation-1.1`
- Frontend: React + Vite + TypeScript
- Offline data: Dexie / IndexedDB
- API: Vercel Functions
- Database: Neon PostgreSQL

## Implemented in the hardening branch

### Reliability and scale foundations
- Deterministic `localSequence` is now required on sync operations.
- Product creation is synchronized before its initial stock receipt.
- Pending operations are sent in sequence order and bounded to 100 per push.
- Pull synchronization uses a stable cutoff and keyset cursor instead of OFFSET paging.
- Current stock can be read from `inventory_balances` instead of summing the full event history.
- Inventory history is made append-only by migration; corrections use compensating events.
- Session activity writes and API-key usage timestamp writes are throttled.
- API-key rate limiting uses an atomic database upsert rather than read-then-write counting.

### Usable business core
- Multi-location workspace foundation.
- Product registration, initial receipt and restocking.
- Per-location stock visibility.
- Multi-item sales cart.
- Cash, bank, transfer, card and credit sale methods.
- Optional customer linkage.
- Customer creation and synchronization.
- Business expense recording and synchronization.
- Below-cost sale reason enforcement.
- Sale void/reversal.
- Automatic accounting foundation for accepted sales, voids and expenses.

### Account security
- Server-backed sessions with HttpOnly cookies.
- Login/register throttling.
- Self-service password-reset request and one-time reset tokens.
- Password reset revokes existing sessions.
- Password reset actions are audited.
- Production email configuration is exposed as a health readiness signal.

## Database migrations required in order

1. `001_core.sql`
2. `002_auth_and_sync.sql`
3. `003_production_hardening.sql`
4. `004_scale_foundation.sql`
5. `005_account_recovery.sql`

The new migrations are committed but have **not** been applied to the production Neon database by this branch.

## External verification blockers observed on 2026-10-07

- GitHub Actions jobs do not start because the GitHub account is locked due to a billing issue.
- Vercel preview builds reached the daily free deployment limit after diagnostic attempts.
- The connected Vercel credential cannot bypass the project's team-level Deployment Protection, so protected preview browser smoke tests cannot currently be performed.
- Before the Vercel rate limit was reached, the build reported a TypeScript/lint failure. Several concrete source defects were repaired afterward, but a final clean build is still required and is not claimed here.

## Release gate

Do not merge this branch to the production branch or apply its migrations to the live database until all are green:

1. `npm run verify`.
2. Preview deployment against an isolated Neon preview branch.
3. Schema migration verification.
4. Register → login → reset password → login.
5. Create product → receive stock → sync → refresh.
6. Restock existing product.
7. Multi-item sale with each payment method.
8. Customer-linked sale.
9. Business expense → accounting entry.
10. Below-cost sale approval validation.
11. Sale void → stock/accounting reversal.
12. Offline create/sell → refresh offline → reconnect → sync.
13. Duplicate retry/idempotency.
14. Two-client final-unit concurrency.
15. Staff/location unauthorized read/write denial.
16. Mobile layout and installable PWA smoke test.
17. Backup/restore and rollback procedure.

No document or version number is allowed to override this gate.
