# The Verge — Deployment

## Target stack

- Application: Vite + React (migration to Next.js is planned before production API scale-out)
- Hosting: Vercel
- Database: Neon PostgreSQL
- Local/offline: IndexedDB via Dexie

## Environment

Never commit `.env` files or database credentials. `DATABASE_URL` is server-only.
Public browser configuration must use only explicitly public `VITE_*` variables.

## Vercel

1. Connect the GitHub repository when account access is restored.
2. Import the project into Vercel.
3. Add `DATABASE_URL` to Production/Preview as appropriate.
4. Deploy a Preview first.
5. Run smoke tests against Preview before promoting Production.
6. Keep Production and Preview data environments separated before real users are onboarded.

## Database migrations

Apply `db/migrations/*.sql` through the migration workflow. Never edit Production tables manually without recording the change in a migration.
