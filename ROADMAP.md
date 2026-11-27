# The Verge roadmap

**Product:** THE VERGE — Powered by Timzee Corp  
**Last reviewed:** 28 November 2026

## Implemented foundations

- Server-backed authentication, sessions, organisation membership, business roles, and staff location assignments.
- Local-first products, inventory events, POS sales, customers, and expenses with IndexedDB outbox, paginated sync, idempotency receipts, and retry scheduling.
- Cashier POS workspace and inventory staff workspace with assigned-location stock visibility.
- Accountant and owner workspaces for expenses, sales review, posted journals, and trial balance.
- Business profile and branch/location lifecycle management.
- Balanced double-entry posting foundations for sales, expenses, opening inventory, purchase receipts, supplier payments, and stock transfers.
- Supplier directory, purchase orders, partial receipts, receipt history, partial supplier settlements, and stock transfers between locations.
- Server-side role and location checks, audit events, idempotent request handling, and stock protection.
- Neon migrations 006 and 007 applied to the default and named production branches after isolated-branch validation.
- Shared glass interface system for all current workspaces, with light/dark surfaces, mobile layouts, visible focus states, and reduced-motion support.

## Next implementation priorities

1. **Accounting completion:** supplier returns and credit notes, payment reversals, bank reconciliation, transfer discrepancy handling, period close, and controlled reversing journals.
2. **Inventory controls:** stock counts, adjustments, batch/lot capture, expiry handling, FEFO allocation, and recall reporting.
3. **Operational usability:** browser walkthroughs for every role, guided first-run setup, clear empty/loading/error states, accessible keyboard navigation, and low-bandwidth/mobile testing.
4. **Reliability testing:** offline/reconnect, duplicate/retry behavior, multi-device sync, and multi-organisation/location isolation using separate accounts.
5. **Release operations:** obtain a successful CI build, deploy the exact reviewed main SHA to Vercel, and run production health/readiness and role-based smoke tests.
6. **Business modules:** enable industry-specific workflows only when the UI, server validation, permissions, and reports are complete.
7. **Integrations:** payment reconciliation, WhatsApp Business, scoped API keys, and webhooks.
8. **AI assistant:** grounded read-only business insights first; write actions require explicit permissions, approvals, and audit records.

## Release principles

- Keep business data tenant-scoped and staff records location-scoped on both server and client.
- Treat offline actions as pending until the server confirms them.
- Keep migrations in source control and validate them on isolated branches before production.
- Do not market the product as accounting-complete or pharmacy-grade until the corresponding end-to-end controls are implemented and tested.
- A successful schema migration does not mean the current application build is deployed or browser-tested.
