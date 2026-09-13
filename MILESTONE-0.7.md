# The Verge — Milestone 0.7

**Powered by Timzee Corp**

## Focus
Core business transaction integrity: a sale is now a first-class record, not only an inventory adjustment.

## Added
- Customer, supplier, sale, sale-item and business-expense domain models.
- Dedicated local IndexedDB stores for sales, sale items, customers, suppliers and expenses.
- Atomic local sale workflow: sale + line item + inventory event + sync operations are committed together.
- Stable sale IDs and inventory reference IDs for future server reconciliation.
- Sale calculation rules for quantity, discount, total and cost.
- Below-cost sales require an explicit reason and never modify the product's standard price.
- Recent sales ledger in the POS screen.
- Database schema version bumped for the new stores.
- ErrorBoundary import corrected for production TypeScript builds.

## Reliability rule
A sale must either be completely written locally or not written at all. This prevents the UI from showing a completed sale while inventory or synchronization data is missing.

## Still deliberately pending
- Server-side authenticated API.
- Neon sync endpoint and idempotent transaction processing.
- Real accounting posting from every sale/purchase/expense.
- Multi-device conflict resolution against authoritative server state.
- Authentication and real business/branch onboarding.

Those are intentionally not faked in this milestone.
