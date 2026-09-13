# EduLedger production readiness

Last audited: 2026-09-13

## Current architecture

- Next.js 16 App Router with React 19 and TypeScript.
- Server-side route handlers provide the application backend.
- PostgreSQL is required in production; SQLite is a development fallback only.
- Tenant ownership is represented by `institution_id`; operational queries inspected during this audit scope reads and mutations to the authenticated user's institution.
- Passwords use bcrypt and sessions use random, expiring, HTTP-only cookies.
- Razorpay subscription activation validates signatures and authoritative provider payment details. Webhooks are deduplicated.
- Receipts and financial reports are generated as real PDFs with `pdf-lib`.

## Findings fixed

- **High — missing mutation authorization:** class creation and teacher update/delete previously required authentication but no administrative role. These routes now require `SCHOOL_ADMIN` or `SUPER_ADMIN`.
- **High — webhook retry correctness:** an invalid Razorpay event was recorded before payment fields were validated, preventing a corrected provider retry. Events are now recorded only after validation.
- **Medium — unhandled UI failures:** App Router error boundaries were missing. App-level and root-layout fallbacks now provide a safe retry experience without showing server details.
- **Medium — report exports:** PDF reports, academic-year filtering, safe report validation, server-calculated totals, and empty states were added.
- **Medium — export type mismatch:** receipt aliases and configured modules are handled by the export API.

## Verified controls

- Payment order prices come from server-owned plan definitions.
- Checkout verification validates HMAC, order ownership, provider order ID, INR amount, and capture status.
- Webhook verification uses the raw request body and configured webhook secret.
- Receipt/payment lookups inspected use `institutionId` alongside record identifiers.
- Financial export routes restrict access to administrators and accountants.
- Production refuses to fall back silently to a local database when no database URL is configured.
- `.env*` is ignored while `.env.example` is intentionally tracked.
- The health endpoint checks the database and returns HTTP 503 when unavailable.

## Remaining launch blockers

These require production infrastructure or broader product decisions and are not verified locally:

1. Configure hosted PostgreSQL through `DATABASE_URL` or `POSTGRES_URL`; the current local environment has no production database URL.
2. Configure and test live Razorpay credentials and the HTTPS webhook in a staging account before accepting money.
3. Enable managed database point-in-time recovery and complete a restore drill. No backup has been restored during this audit.
4. Add a distributed rate limiter for login and registration (for example, an edge-compatible Redis service). An in-memory limiter is intentionally not presented as production protection because it fails across serverless instances.
5. Password-reset and email-verification screens exist, but a complete token/email delivery workflow has not been verified; do not advertise these as active until implemented and tested.
6. User provisioning and parent/student ownership workflows are incomplete for the full six-role product described in the brief. Existing administrative/accounting paths are stronger than the end-user portals.
7. Configure error monitoring and alert delivery. Logs currently avoid sensitive error messages, but no external monitoring destination is configured.
8. The runtime creates application tables idempotently. Before multiple production instances are used, move schema evolution to versioned, reviewed migrations executed once during deployment.

## Risk notes

- Existing student admission numbers and receipt numbers are globally unique. This is safe for isolation but can reject the same admission number used by different schools. Changing uniqueness requires a reviewed, non-destructive data migration.
- Financial and student list endpoints should move to cursor/page-based UI pagination before onboarding very large schools.
- Uploaded school logos do not yet have a complete signed object-storage upload lifecycle.
- Detailed payroll fields such as allowances and deductions are not in the current ledger model; reports correctly avoid inventing them.

## Release gate

A production release is approved only after all of the following pass in staging:

1. `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
2. `/api/health` reports `database: connected`.
3. Registration, login, logout, tenant isolation, student creation, fee collection, receipt PDF, report PDF, and Razorpay webhook smoke tests pass.
4. A database backup is created and restored into an isolated staging database.
5. Rollback of the deployed application version is rehearsed without rolling back committed financial data.

