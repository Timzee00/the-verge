# THE VERGE — Production and Scalability Plan

This plan is the default engineering contract for future work. New features must preserve the correctness and scale guardrails here rather than postponing them until the product is large.

## Product goal

THE VERGE is an offline-first business operating system. The launch core should let a real business sign in, operate one or more locations, manage products and stock, maintain customers, record expenses, complete and reverse sales, and synchronize those actions without corrupting inventory or financial history.

## Phase 1 — Stable usable core

Release only when all of these are true:

- Registration, login, logout and password recovery work on the production origin.
- Email delivery is configured before public onboarding.
- Organization, role and location authorization negative tests pass.
- Product creation and receiving synchronize in deterministic sequence order.
- Existing products can be restocked.
- Stock remains correct after offline work, refresh and reconnect.
- Multi-item sales support customer linkage and cash, bank, transfer, card and credit payment methods.
- Below-cost sales require an auditable reason and are revalidated server-side.
- Sale voids restore stock and reverse accounting.
- Customers and business expenses synchronize.
- Sales and expenses create balanced accounting entries.
- The PWA opens after installation while offline.
- Exported account data is scoped to the signed-in user/workspace.
- Health checks fail closed when required schema is missing.

## Phase 2 — Production operations

Before broad public launch:

- Green frontend typecheck, API typecheck, domain tests and Vite production build.
- Integration tests against a disposable Neon branch.
- Browser E2E tests for auth, inventory, POS, expenses, offline/reconnect and cross-location denial.
- Concurrency test: two clients attempt to sell the last unit; exactly one succeeds.
- Idempotency/retry tests for requests whose response is lost after commit.
- Backup and restore drill.
- Error monitoring, latency metrics, database metrics and alerting.
- Dependency and secret scanning.
- Security review and penetration testing.
- Legal/privacy review and documented data retention/deletion rules.
- Staged production deployment with a tested rollback path.

## Scale guardrails that apply now

These are not future optional refactors:

1. **Immutable financial and inventory facts.** Correct mistakes with compensating records; do not silently rewrite history.
2. **Current-state projections.** Read hot stock values from `inventory_balances`; retain `inventory_events` as the rebuildable source of truth.
3. **Cursor synchronization.** Never introduce deep OFFSET pagination into high-growth sync feeds.
4. **Bounded batches.** Sync in controlled batches and make every operation idempotent.
5. **No request-wide hot writes.** Session telemetry and credential usage timestamps are throttled rather than updated on every read.
6. **Server-side tenant boundaries.** Every sensitive query and mutation must prove organization/location membership; client filtering is not authorization.
7. **Integer money.** Do not use floating-point values as financial truth.
8. **Transaction boundaries.** A sale, its line items, stock movements and accounting effects succeed or fail together on the server.
9. **Versioned APIs and migrations.** Never change a public contract or production schema silently.
10. **Queue-ready side effects.** Email, WhatsApp, webhooks, reports, payment verification, analytics and AI must be downstream work, not part of the critical sale commit.

## Phase 3 — Complete business operations

After the core is stable:

- Suppliers and supplier balances.
- Purchase orders, goods receiving, batches and expiry tracking.
- Branch-to-branch stock transfers.
- Quotes, invoices, customer receivables and repayments.
- Supplier payables.
- Payment records, bank-transfer verification and reconciliation.
- Profit & loss, balance sheet, cash-flow and tax/report exports.
- Staff invitations, session/device management, MFA and stronger owner/admin controls.
- Subscription billing, entitlements, suspensions and platform-owner control center.
- Webhooks and broader Developer API coverage.

## Phase 4 — Channel layer

Only verified core commands may be exposed to:

- Business websites/storefronts.
- WhatsApp and Timzee MD.
- Mobile/native clients.
- Partner integrations.

Channels never own independent stock or order databases.

## Phase 5 — AI layer

AI can explain, search, summarize, forecast and propose actions through permissioned tools. It must not become the source of truth for balances, stock, permissions, payments or accounting entries.

## Scale-out triggers

Keep the system as a modular monolith until measurements justify extraction. Introduce dedicated queue workers, distributed rate limiting, cache/read replicas, analytical stores, partitioning or independently scaled services only when observed traffic, latency, storage or team boundaries justify them.

The target architecture may serve millions, but the rollout remains progressive: internal users → a few pilot businesses → tens → hundreds → thousands → larger cohorts, with measured error rate, sync conflict rate, latency, database load and recovery performance at each stage.
