# The Verge — Deployment

## Target stack

- Application: Vite + React
- Hosting: Vercel
- Database: Neon PostgreSQL
- Local/offline: IndexedDB via Dexie

## Environment

Never commit `.env` files or database credentials. `DATABASE_URL` is server-only. Public browser configuration must use only explicitly public `VITE_*` variables.

## Vercel release process

1. Confirm the intended Vercel team, project, Git branch, and commit SHA.
2. Confirm the required environment variables are present without exposing their values.
3. Obtain a successful CI build and unit-test run.
4. Deploy a Preview and test authentication, business selection, owner, cashier, inventory, accountant, and sync journeys.
5. Promote only the exact tested build to Production.
6. Run `/api/health` and `/api/ready` plus role-based smoke tests after release.

## Database migrations

Apply `db/migrations/*.sql` through the migration workflow. Validate on an isolated Neon branch cloned from the intended target before applying. Never edit Production tables manually without recording the change in a migration.

### 28 November 2026 database status

- Migrations 006 and 007 were tested on isolated clones and applied to both the Neon default `main` branch and the named `the-verge-production` branch.
- The default branch contains one organisation, one user, one membership, ten standard ledger accounts, the ten procurement tables, and the two deferred journal-balance triggers.
- No journal entries or journal lines existed before the default-branch migration; existing operational transactions were not rewritten.
- The named production branch had no organisation/user records at the time of migration.

## Current release status

The unified glass UI is committed to GitHub main, but it is not yet live. Latest GitHub Actions run `46080702234` failed before job steps or logs were available, and Vercel's `timzee-deploy-format-test` check reports a build-rate-limit failure. The latest READY deployment is still on an older commit (`58cc1b9`). Do not treat the current source as released until CI passes, the exact main commit is deployed, and browser smoke tests pass.


### Vercel quota confirmation — 28 November 2026
- A direct Preview deployment attempt for the current main HEAD was rejected by Vercel with HTTP 402: `api-deployments-free-per-day`, more than 100 deployments in the current free daily allowance; retry window reported as 86,400 seconds.
- No new deployment was created. Do not retry or change billing/plan settings without the user's direction.
