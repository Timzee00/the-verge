# The Verge — Build status
**Snapshot:** 27 November 2026  
**Repository:** `Timzee00/the-verge`  
**Branch:** `main`  
**Repository HEAD:** `094fe55752ec25b90d75db5bd79d6ebf915dead0` (QA/build documentation update)  
**Latest reviewed application-code commit:** `e88cca8e88916e0bc7a644056303e2ebf6fae622`

## Current verified state

The current main branch contains the following working-code foundations:

- Vercel API authentication, session lookup, organisation membership checks and server-side role checks.
- Organisation-scoped products, customers, sales, inventory events and expense sync.
- Explicit staff-to-location assignments and server-side location checks for inventory, sales and expenses.
- Offline IndexedDB outbox, paginated pull cursors, retry timestamps and idempotent sync receipts.
- Cashier POS workspace.
- Inventory staff workspace with assigned-location stock visibility, stock receipt capture, barcode/spreadsheet tools and offline sync.
- Accountant workspace with selected-location expense entry and sales/expense review.
- Owner accounting screen with business expense entry and recent expense review.
- Shared inventory movement validation and server-side checks against negative stock for destructive movements.
- Fail-closed UI role fallback when no active membership is found.

## Build evidence

- Vercel built commit `aa5b6f68128b983eacbd5973e0a4f90ed91b6c2c` using `tsc -b && vite build`; the captured log showed Vite completing successfully with no TypeScript diagnostics.
- That build followed the fix to the API import path for the shared inventory movement validator.
- Subsequent commits changed the expense index migration, selected-location summaries, and atomic sequence allocation in inventory receipt/import flows.
- Vercel deployed the current `main` HEAD `094fe55752ec25b90d75db5bd79d6ebf915dead0` successfully (`READY`). The build ran `tsc -b && vite build`, Vite completed in 3.85 seconds, and Vercel reported `Deployment completed`.
- Live read-only checks: `/` returned HTTP 200; `/api/health` returned `ok`; `/api/ready` returned `ready` with `database: ok`.

## Tests not yet confirmed

- `npm run test:domain` after the latest inventory movement test additions: **NOT RUN in this verification pass**.
- GitHub Actions run for the latest commit: **no workflow run was returned**.
- Browser smoke tests across owner, cashier, inventory staff and accountant accounts: **NOT RUN**.
- Offline/reconnect tests on real devices: **NOT RUN**.
- Multi-organisation and multi-location isolation tests using separate accounts: **NOT RUN**.

## Database and environment status

- Migration `db/migrations/005_expense_sync_indexes.sql` is committed. It adds organisation/time and organisation/location/time indexes to support the paginated expense feed.
- The migration has **not** been applied to Preview or Production through this session.
- No production database records, production secrets or environment variables were changed.
- Production credentials and provider integrations were not inspected or modified.

## Release blockers

Do not describe this build as production-ready until these items are completed:

1. Apply all outstanding database migrations to an isolated Preview database, then Production after validation.
2. Complete registration, email, login, workspace selection and branch isolation browser smoke tests.
3. Test cashier sales, stock receipts, expense sync, offline/reconnect and duplicate/retry behavior across separate devices.
4. Finish location creation/edit/archive controls and business profile management.
5. Post expenses and other operational records into balanced double-entry journals; the current expense feature is an operational expense ledger, not an automatic accounting-posting engine.
6. Complete supplier purchasing, transfer workflows and pharmacy batch/expiry/recall enforcement before advertising pharmacy-grade support.
7. Review personal-finance local data scoping for shared devices and complete generic `staff` role behavior.
8. Confirm GitHub Actions and the latest Vercel deployment are green, then run a production smoke test.

## Product identity

**THE VERGE — Powered by Timzee Corp**

The product is intended as a local-first Nigerian SME business operating system. Current code is a production candidate, not a certified production release.


## Final review addendum — 27 November 2026

Further changes now committed after the prior status snapshot:
- Opening inventory movements create balanced opening-equity journals; only owner/admin/manager roles can sync opening stock.
- Supplier payment source type is included in the journal source constraint migration.
- Supplier payment API and UI support partial receipt settlement, outstanding balance validation, exact retry payloads and AP/cash-bank journal posting.
- Inventory staff no longer have the unlinked stock receiving or catalogue import path; they receive against assigned purchase orders.
- Sync validation now leaves unknown/database-schema errors retryable instead of incorrectly marking them permanently rejected.

These are source changes only. The current main branch has not been built or deployed in this session. Migrations 006 and 007 remain unapplied. CI/domain tests and browser end-to-end tests for this latest code remain **NOT RUN**.
