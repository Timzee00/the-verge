# The Verge — Milestone 0.9

## Pilot server foundation

This milestone moves The Verge from local-only pilot structure toward a real multi-user web application.

### Added
- Server-backed account registration and login.
- HttpOnly SameSite session cookie with 30-day pilot session lifetime.
- Server-side PBKDF2 password hashing.
- Authenticated session lookup and logout.
- Organization membership authorization before business sync access.
- Neon sync receipt/idempotency layer using device + local sequence and organization/entity identity.
- Neon persistence for customers, sales, sale items, and expenses.
- Server sync endpoints for inventory events, products, customers, sales, and expenses.
- Cross-device pull for products, locations, inventory events, and sales.
- Same-origin Vercel API + Vite deployment configuration without a catch-all rewrite overriding API routes.
- Removed the unused Supabase client dependency from the active Neon code path.

### Verified
- Neon additive migration tested on a temporary branch and then applied to the main branch.
- Required pilot tables confirmed in Neon.
- Domain test suite passes.
- API TypeScript checked independently with connector shims.

### Not yet claimed
- Full `npm run build` has not passed in this environment because dependency installation timed out.
- No Vercel deployment has been claimed yet.
- Full browser/real-device pilot QA still needs to be run after the first deployment.
- Email verification, password reset, MFA, provider payments, advanced conflict resolution, and full accounting sync are still future gates.
