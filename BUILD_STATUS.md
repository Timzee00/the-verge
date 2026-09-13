# The Verge v0.5.0 build status

## Verified in this environment
- Domain TypeScript compilation using the installed TypeScript 5.8.3 compiler.
- Domain test suite: passed.
- Money is stored/calculated in integer minor units.
- Journal entries are validated as balanced double-entry structures.
- Role permission matrix compiles and is tested.
- Portable account export envelope validation compiles and is tested.

## Not claimed as verified here
- Full `npm run build`: npm dependency installation timed out in the build environment, so the full Vite build was not falsely marked as passing.
- Live Supabase authentication/synchronization: schema foundation exists; production RPCs/idempotency and cloud adapter are the next implementation milestone.
- Live WhatsApp/payment provider integrations: not yet connected.

## Product identity
The application is branded **THE VERGE — Powered by Timzee Corp**.


## 1.0.0 — Pilot server foundation

- Server-backed account registration, login, session lookup, and logout via Vercel API routes.
- Passwords are hashed server-side with PBKDF2; the browser never stores the password hash.
- Pilot sessions use an HttpOnly SameSite cookie.
- Neon now includes user credentials/sessions, sync receipts, customers, sales, sale items, and expenses.
- Organization membership is checked before sync reads/writes.
- Inventory, product, customer, sale, and expense sync endpoints are present; duplicate device sequence numbers are deduplicated server-side.
- Cross-device pull includes products, locations, inventory events, and sales.
- Active deployment target remains Vercel + Neon. No production deployment has been claimed yet.
- Full dependency-based build is still blocked in this environment because npm install times out; domain tests pass and the API layer passes isolated TypeScript checking with connector type shims.


## Milestone 1.0 production-candidate hardening
- Real Postgres transaction semantics for registration and sync writes.
- Persistent per-browser device ID and IndexedDB-backed local sequence reservation.
- Server-side inventory conflict protection for offline sales.
- Sale sync can atomically persist sale + sale items + inventory event.
- Conflict/rejected sync states now surface in local records.
- Node.js 24 pinned for Vercel.
- CI workflow added for typecheck, domain tests, and build.

Validation in this environment: domain tests PASS; API source validation PASS with lightweight dependency declarations. Full dependency install/build remains blocked by an environment package-install timeout, so a live Vercel smoke test is still required before inviting real users.
