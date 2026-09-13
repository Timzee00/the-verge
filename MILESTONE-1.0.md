# The Verge — Milestone 1.0

## Production candidate gate

This milestone hardens the cloud boundary before pilot users are invited.

### Included
- Node.js 24 pinned for Vercel builds/functions.
- Server-side password hashing with PBKDF2 and constant-time digest comparison.
- Real Postgres transaction semantics for registration and sync writes.
- Organization membership checks on synchronization.
- Role gate for write operations.
- Idempotent sync receipts.
- Server-side inventory sale conflict protection using a transaction-scoped advisory lock and physical-stock check.
- Multi-line sale payload support.
- Customer and location ownership validation.
- Local development logout cookie works without Secure; Vercel remains Secure.
- GitHub Actions CI for install, typecheck, domain tests, and production build.

## Not yet claimed
- A successful cloud deployment from this environment.
- A browser smoke test against Vercel.
- Full payment-gateway verification.
- Email verification/password reset.
- Complete accounting posting for every business transaction.

## Pilot gate

A tester should not be invited until CI is green and the live smoke test succeeds for: register → login → create product → receive stock → sell online → sell from two clients against one remaining unit → verify one succeeds and the other becomes a conflict → pull synchronized data → logout.
