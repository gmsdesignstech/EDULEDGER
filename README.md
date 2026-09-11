# EduLedger

EduLedger is a production-oriented, multi-role school operations platform built with Next.js, TypeScript, Tailwind CSS and PostgreSQL.

## Run locally

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to a PostgreSQL connection string.
3. Start the app: `npm run dev`.
4. Register a school account at `/register`, then sign in at `/login`.

The PostgreSQL schema and subscription plans are created idempotently on the first database request. Passwords are bcrypt-hashed, and sessions use random server-side tokens in secure HTTP-only cookies.

The dashboard is protected on the server. Unauthenticated requests are redirected to `/login`; student reads and writes are scoped to the institution attached to the authenticated session.

## School operations

The authenticated dashboard uses PostgreSQL as a single durable source of truth for students, teachers, classes, attendance, fee invoices, payments, receipts, activity, notifications, settings and audit history.

- Add a student from `/dashboard/students`. A fee above zero creates a unique annual-fee invoice.
- Record installments from `/dashboard/payments`. Amounts are validated on the server and cannot exceed the remaining balance.
- Search all transactions at `/dashboard/payment-history`; receipts can be viewed, printed or downloaded as generated PDFs.
- Mark class attendance at `/dashboard/attendance`. Student percentages and dashboard totals recalculate from stored attendance.
- Import `.xlsx`, `.xls` or `.csv` templates from `/dashboard/import`. Invalid rows are skipped and reported.
- Filter a module and use its export controls to download live CSV or Excel records.
- Configure the active academic year and receipt contact details at `/dashboard/settings`.

Student fees are independent from the Razorpay-backed school subscription verification route. Recording a student fee payment never activates or changes a SaaS subscription.

## Annual school subscriptions

New school accounts continue from registration to `/subscription`, where six annual plans cover 250–1,000 active students. Plan prices and capacities are loaded on the server; the browser submits only a plan identifier. Mutating school-operation APIs require an active subscription, while login, logout, profile/settings, read/export access, activation endpoints, and Razorpay webhooks remain available.

Razorpay configuration uses `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. Configure the webhook URL as `https://YOUR_DOMAIN/api/subscription/webhook` and subscribe to `payment.captured`, `payment.failed`, and `order.paid`.

## Production setup

- In Vercel, open **Storage**, create or connect a managed PostgreSQL database, and connect it to this project. The app accepts either `DATABASE_URL` or Vercel's `POSTGRES_URL`.
- Add the remaining variables from `.env.example` in Vercel. Set `NEXT_PUBLIC_APP_URL` to the production HTTPS origin and never expose provider secrets as `NEXT_PUBLIC_*` values.
- Redeploy after changing environment variables. The application creates its tables and indexes automatically on the first request.
- Configure Google OAuth with the deployed origin and callback URL used by your auth provider.
- Configure Razorpay to call an HTTPS webhook endpoint. Verify `X-Razorpay-Signature` against the raw request body and update Payment + Subscription in one database transaction. The included verification endpoint demonstrates constant-time checkout signature validation; it deliberately does not unlock plans without persistence.
- Configure signed Cloudinary uploads with server-generated signatures, MIME allowlists and size limits.
- Protect `/dashboard` with server-side session checks and call `can()` at every mutation boundary. UI visibility is not authorization.

## Quality commands

- `npm run typecheck`
- `npm test`
- `npm run build`

## Payment smoke test

1. Register or sign in as a school administrator.
2. Add a student with a total annual fee and due date.
3. Open **Fees & Payments**, select **Add payment**, enter an amount and method, then save.
4. Confirm the updated paid/pending totals, dashboard collection, payment-history row and notification.
5. Open the generated receipt and use **Download PDF** or **Print receipt**.

## Architecture notes

The database layer is tenant-aware through `institutionId`, includes indexed operational tables, and uses transactions for account creation, admissions, payments, attendance and subscription activation. Health, sitemap, robots, security headers and reduced-motion behavior are included.
