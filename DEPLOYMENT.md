# THE VERGE — deployment and release procedure

## Production stack

- Frontend: Vite + React
- Hosting: Vercel
- Database: Neon PostgreSQL
- Local/offline database: IndexedDB via Dexie
- Server API: Vercel functions in `/api`

The active backend for THE VERGE is **Neon**. Supabase is not part of the active production path.

## Environment variables

Only server-side code may read `DATABASE_URL`.

Never commit:
- database URLs
- database passwords
- session secrets
- API credential secrets
- provider credentials

Browser-visible configuration must use only explicitly public `VITE_*` values.

## Database migration order

Migrations are ordered files under `db/migrations/`.

Current sequence:
- `001_*`: original core schema
- `002_*`: authentication and sync foundation
- `003_production_hardening.sql`: location scopes, sync sequencing, auth throttling, API credentials, and integrity constraints

Apply migrations in order against the intended Neon environment. Record the exact migration version before enabling the corresponding server code.

## Preview release process

1. Push the feature branch.
2. Require frontend typecheck.
3. Require API typecheck.
4. Run domain tests.
5. Run the complete Vite build.
6. Deploy a Vercel Preview.
7. Verify the preview against a test database, never the real customer database.
8. Test registration, login, logout, refresh, offline work, reconnect, duplicate sync, and authorization.
9. Confirm no secrets appear in browser bundles or logs.
10. Promote to Production only after the smoke-test checklist passes.

## Database safety

Never point a Preview deployment at the production database before a deliberate review.

For production migrations:
- take a current schema snapshot
- apply the migration in a controlled window
- verify expected tables/constraints/indexes
- run read-only integrity checks
- run a small authenticated smoke test
- keep rollback notes for the migration

## Domain and Vercel URLs

Vercel generated deployment URLs and the project's production domain are different concepts.

A generated preview URL can contain deployment/team identifiers. The final clean production alias must be assigned to the Vercel project under its Domains settings and must be available.

Do not hardcode a guessed production URL into the application.

## Secrets and API credentials

THE VERGE API credentials are stored as hashes. The secret is displayed only when created and can be revoked or allowed to expire.

Treat a newly generated API secret like a password:
- never commit it
- never paste it into source code
- never include it in screenshots
- rotate it when exposure is suspected

## Release gate

A branch is not production-ready merely because the UI renders.

Release requires:
- green CI
- successful production build
- applied database migrations
- authorization tests
- offline/sync tests
- mobile smoke tests
- error-state verification
- rollback plan
