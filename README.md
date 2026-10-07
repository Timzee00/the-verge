# THE VERGE
### Powered by Timzee Corp

THE VERGE is an offline-first business operating system for small and growing businesses. It keeps sales, stock, customers, expenses, accounting, branches and connected channels in one trustworthy workspace while allowing day-to-day work to continue when the internet is unreliable.

## What the product is built to do

- Run a multi-location business from phone or desktop.
- Keep an immutable inventory history while exposing fast current stock balances.
- Record multi-item POS sales, customers, business expenses and sale reversals.
- Post verified sales and expenses into a double-entry accounting foundation.
- Work locally first in IndexedDB and synchronize safely with Neon PostgreSQL.
- Keep organization, role and location authorization enforced on the server.
- Expose scoped API credentials so websites and future channels use the same business truth.
- Grow into purchasing, suppliers, transfers, payments, reports, WhatsApp and a controlled AI assistant without creating separate data silos.

## Production stack

- Frontend: React + TypeScript + Vite
- Offline/local data: Dexie + IndexedDB
- API: Vercel Functions
- Primary database: Neon PostgreSQL
- Hosting: Vercel

## Engineering rules

Financial amounts use integer minor units. Inventory history is append-only and stock is projected into a current-balance table for fast reads. Client writes carry deterministic device sequence numbers and server sync is idempotent. Sync pulls use cursors rather than deep offsets. Business authorization is enforced server-side by organization, role and location.

See `PRODUCTION_PLAN.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEPLOYMENT.md` before changing transaction, authorization or synchronization code.
