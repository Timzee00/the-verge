# The Verge roadmap

**Product:** THE VERGE — Powered by Timzee Corp  
**Last reviewed:** 27 November 2026

## Implemented foundations

- Server-backed authentication, sessions and organisation membership checks.
- Multi-organisation core with business roles and staff location assignments.
- Local-first product, inventory-event, POS sale and customer records.
- IndexedDB outbox, paginated sync pull, idempotency receipts and retry scheduling.
- Cashier checkout workspace.
- Inventory staff workspace with assigned-location stock view, goods receiving and bulk inventory tools.
- Accountant workspace with selected-location sales and expense review.
- Owner business-expense entry and operational expense ledger.
- Shared inventory movement validation and server-side stock protection.
- Vercel deployment and Neon PostgreSQL integration foundations.

## Next implementation priorities

1. **Business setup and location management:** business profile, create/edit/archive branches and warehouses, location-level settings and receipt identity.
2. **Accounting integrity:** post each sale, expense, purchase and transfer to balanced journal entries; add period close, reversals, reconciliation and immutable audit history.
3. **Purchasing and suppliers:** supplier directory, purchase orders, receiving, partial deliveries, supplier balances and returns.
4. **Inventory controls:** stock counts, adjustments, inter-branch transfers, batch/lot capture, expiry handling, FEFO allocation and recall reporting.
5. **Production testing:** owner/cashier/inventory/accountant browser journeys, multi-device offline testing, retry/idempotency testing and multi-tenant isolation.
6. **Release operations:** verify all migrations in Preview, verify GitHub Actions, complete the Vercel build and run production smoke tests.
7. **Business modules:** only enable industry-specific workflows when the required UI, server validation, permissions and reports are complete.
8. **Integrations:** payment provider reconciliation, WhatsApp Business, scoped API keys and webhooks.
9. **AI assistant:** grounded read-only business insights first; any write actions require explicit permissions, approvals and audit records.

## Release principles

- Do not merge long-diverged feature branches into `main` without rebasing and reviewing the full diff.
- Keep business data tenant-scoped and staff records location-scoped on both server and client.
- Treat offline actions as pending until the server confirms them.
- Never infer that a production migration or provider integration is active merely because code exists.
- Do not market a vertical as pharmacy-grade or accounting-complete until its end-to-end controls are implemented and tested.


## Final review addendum
- Supplier balances and receipt-linked partial payments are now part of the committed code.
- Opening product quantities are posted against owner equity.
- Inventory staff receive stock only through purchase orders.
- The new supplier-payment journal source is covered by migration 006.
- Current main still awaits Preview migrations, CI execution, browser role testing and a fresh Vercel deployment.
