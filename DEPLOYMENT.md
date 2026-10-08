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

For self-service password recovery in Production also configure:
- `APP_BASE_URL` — the canonical HTTPS origin, for example `https://app.example.com`
- `BREVO_API_KEY` — server-only email provider credential
- `AUTH_EMAIL_FROM` — verified sender identity used for account security emails

The health endpoint reports `mailConfigured`; public onboarding should not be enabled until it is true.

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
- `004_scale_foundation.sql`: inventory balance projection and immutable inventory event guard
- `005_account_recovery.sql`: one-time password reset tokens
- `006_store_setup.sql`: store contact/receipt configuration, setup completion state, and unique store codes
- `007_retail_pharmacy_foundation.sql`: medicine/regulated product metadata plus batch, expiry, FEFO, quarantine and recall-ready lot storage
- `008_business_modules.sql`: capability-based presets for retail, supermarket, pharmacy, clinic, restaurant, fashion, printing, real estate, services and other business types
- `009_saas_billing.sql`: tiered subscriptions, manual bank upgrade requests, approval state and metered usage counters
- `010_ai_insight_cache.sql`: short-lived grounded AI insight cache keyed to synchronized business changes
- `011_notifications_email.sql`: email preferences, customer communication consent and asynchronous outbound-message queue
- `012_brevo_delivery_events.sql`: Brevo transactional delivery event ledger and current message-status projection
- `009_email_verification.sql`: one-time email verification tokens for public onboarding

Apply migrations in order against the intended Neon environment. Record the exact migration version before enabling the corresponding server code.

Migrations `004`–`009` are additive and must be applied **before** deploying application code that requires their tables or columns. For `006_store_setup.sql`, verify that legacy blank/duplicate store codes were normalized and that the `locations_org_code_unique` index exists before enabling public onboarding. Verify `009_email_verification.sql` before opening self-service registration, because registration now issues a one-time verification token.

## Preview release process

1. Push the feature branch.
2. Require frontend typecheck.
3. Require API typecheck.
4. Run domain tests.
5. Run the complete Vite build.
6. Deploy a Vercel Preview.
7. Verify the preview against a test database, never the real customer database.
8. Test registration, verification-email delivery, verification-link expiry/one-time use, login, logout, password reset, refresh, offline work, reconnect, duplicate sync, and authorization.
9. Complete the new-user Setup Guide end to end: business profile → selected store → store details → products → opening stock → first sale.
10. Add a second store and verify stock/sales remain scoped to the selected store.
11. Confirm no secrets appear in browser bundles or logs.
12. Promote to Production only after the smoke-test checklist passes.

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


## Supermarket / pharmacy release gate

Do not advertise THE VERGE as pharmacy-grade until lot-level receiving and lot-level sale allocation are active end to end. The target workflow is:
- GTIN/barcode product lookup
- batch/lot captured on receiving
- manufacture/expiry dates where applicable
- FEFO allocation at sale
- expired/recalled/quarantined stock blocked at POS
- near-expiry dashboard and alerts
- supplier-to-batch traceability and recall report
- role controls for sensitive/controlled medicine operations


## Multi-business product architecture

THE VERGE uses a universal core (POS, inventory, customers, suppliers, purchasing, expenses, accounting, reports, staff, multi-location, offline sync, receipts, audit, exports and notifications) plus vertical modules.

Changing a business type refreshes only preset modules. Explicit manual module choices are retained. This prevents restaurant, pharmacy, fashion, service and other workflows from being forced into one overloaded interface.


## AI Copilot configuration

The AI layer uses an OpenAI-compatible provider. Configure:
- `AI_API_KEY`
- `AI_MODEL`
- `AI_BASE_URL` (optional; defaults to OpenRouter's OpenAI-compatible base URL)
- `APP_BASE_URL`

Groq or another OpenAI-compatible gateway can be used by changing `AI_BASE_URL` and `AI_MODEL`. Never expose the AI key to the browser.

The current Copilot is read-only. It analyzes server-authorized sales, inventory, expenses and branch data and does not directly mutate products, stock, prices, accounting or customer records. Owner briefings are cached against the latest synchronized change sequence to reduce repeated provider cost.

Billing configuration also requires `PLATFORM_ADMIN_EMAILS`, `BILLING_BANK_NAME`, `BILLING_ACCOUNT_NAME`, and `BILLING_ACCOUNT_NUMBER`.


## Business email and notifications

Configure:
- `BREVO_API_KEY`
- `BUSINESS_EMAIL_FROM` for receipts, owner summaries and operational mail
- `BREVO_SENDER_NAME` (optional; defaults to `THE VERGE by Timzee Corp`)
- `AUTH_EMAIL_FROM` for account/security email
- `MAIL_WORKER_SECRET` (or schedule endpoints behind an equivalent secret)

Customer transactional email and marketing consent are stored separately. Do not use receipt/transactional consent for campaigns.

Queue processing endpoint: `POST /api/jobs/mail` with `Authorization: Bearer <MAIL_WORKER_SECRET>`.
Scheduled notification generation: `POST /api/jobs/notifications` with the same secret. Run the notification generator on an appropriate scheduler, then the mail worker can drain remaining retries. The generator is idempotent by date/week and does not call AI by default.


## Brevo delivery webhooks

Create a **transactional email** webhook in Brevo with notify URL:

`<APP_BASE_URL>/api/webhooks/brevo`

Track at least these events:
- sent/request
- delivered
- opened / unique opened
- click
- deferred
- soft bounce
- hard bounce
- invalid email
- blocked
- error
- spam
- unsubscribed

Configure a custom webhook header:

`X-Verge-Webhook-Secret: <BREVO_WEBHOOK_SECRET>`

And set the same value in the deployment environment as `BREVO_WEBHOOK_SECRET`.

THE VERGE stores webhook events idempotently. Unsubscribe disables customer marketing email. Spam, hard-bounce, invalid-email and blocked events disable both transactional and marketing email for that customer until the address/preferences are corrected.
