# EduLedger operations runbook

## Required production configuration

Set these secrets only in the hosting provider; never commit their values:

- `DATABASE_URL` (or `POSTGRES_URL`): pooled PostgreSQL connection string.
- `NEXT_PUBLIC_APP_URL`: canonical HTTPS origin.
- `ADMIN_USER_ID`: immutable ID of the sole user whose database role is `SUPER_ADMIN` (preferred). `ADMIN_EMAIL` is the fallback identity selector.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`: required when paid subscriptions are enabled.

Optional integrations listed in `.env.example` must remain unset until their server-side implementation is enabled.

## Deployment

1. Create an isolated staging environment and database.
2. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` in CI.
3. Deploy the exact tested commit to staging and verify `/api/health`.
4. Test login, a database write, fee payment, PDF generation, and a Razorpay test webhook.
5. Back up production, deploy the same artifact, and repeat health/smoke checks.

## Backup and restore

Use the managed PostgreSQL provider's automated daily backups and point-in-time recovery. A practical initial policy is 30 daily backups and 12 monthly backups, adjusted for legal and school retention requirements.

Restore drill:

1. Create a new isolated PostgreSQL instance.
2. Restore the selected backup into it; never overwrite production for a drill.
3. deploy the matching application revision with the restored database URL.
4. Verify tenant counts, recent payments, receipt lookup, and audit records.
5. Record restore duration, data-loss window, and verification results.

Back up uploaded assets through the object-storage provider's versioning/replication feature. Database backups do not contain external file bytes.

## Monitoring

- Poll `/api/health`; alert on consecutive 503 responses.
- Alert on elevated 5xx responses, authentication failures, Razorpay webhook failures, and PDF failures.
- Do not send passwords, session tokens, database URLs, raw webhook bodies, or unnecessary student data to monitoring.
- Monitor database connections, storage, slow queries, backup completion, and certificate/domain expiry.

## Incident and rollback

If a deployment fails, route traffic back to the last known-good application artifact. Do not restore an older database merely to roll back code. Apply a database restore only for confirmed corruption/data-loss incidents, with an approved recovery point and preserved forensic copy.

If Razorpay is unavailable, stop new order creation and retain pending orders; never activate subscriptions based solely on a browser callback. Reconcile using signed webhooks/provider verification after recovery.
