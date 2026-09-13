# The Verge
### Powered by Timzee Corp

The Verge is a local-first personal finance and business operating platform.

It is designed around a trustworthy financial ledger, event-based inventory, offline synchronization, multi-location operations, role/entitlement controls, customer and supplier workflows, API/WhatsApp integrations, and a future AI assistant.

## Current engineering priorities

1. Correct accounting and inventory primitives
2. Offline-first transaction capture and deterministic synchronization
3. Strong identity, organization, role, entitlement and audit boundaries
4. Production deployment on Vercel with Neon PostgreSQL
5. Mobile-first, accessible, graphical UX without emoji-based UI

The production architecture is intentionally being built in layers so external channels such as websites and WhatsApp use the same business core rather than maintaining separate inventories.
