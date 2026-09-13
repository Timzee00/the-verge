# The Verge roadmap

## Completed in v0.5.0
- Product identity changed to The Verge / Timzee Corp
- Core personal finance data structures
- Business/organization data structures
- Role and entitlement primitives
- Accounting chart + balanced journal validation
- Inventory events + local stock calculation
- Offline outbox and conflict states
- Portable account export envelope
- Consent/privacy primitives
- Production-oriented responsive shell

## Next implementation milestone
1. Supabase Auth + organization bootstrap + secure RLS write paths
2. Real accounting posting engine for sale/purchase/expense/transfer
3. Product receiving with supplier/batch/expiry and barcode validation
4. Cart/POS with customer-specific discounts and below-cost approvals
5. Server idempotency keys + sync cursor + conflict reconciliation
6. Branch transfer workflow
7. Payment records + provider verification + reconciliation
8. Admin control center for subscriptions, grants, suspensions and audits
9. API keys/scopes + webhooks
10. WhatsApp Business integration
11. Industry modules and Custom Business Builder
12. AI tool layer over verified business data


## Completed server foundation

The 0.9.0 milestone adds pilot authentication, Neon session storage, server-side membership checks, idempotent sync receipts, and synchronized business sales/inventory records.
