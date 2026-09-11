import Link from "next/link";
import {
  CalendarCheck,
  GraduationCap,
  IndianRupee,
  ReceiptIndianRupee,
  TrendingUp,
  UserRoundX,
  Users,
  WalletCards,
} from "lucide-react";
import { dashboardData } from "@/lib/db";
import { requireUser } from "@/lib/session";
export const runtime = "nodejs";
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
export default async function Dashboard() {
  const user = await requireUser(),
    data = await dashboardData(user.institutionId),
    firstName = user.name.split(" ")[0],
    today = new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date()),
    stats = [
      ["Total students", String(data.students), GraduationCap],
      ["Total teachers", String(data.teachers), Users],
      ["Present today", String(data.present), CalendarCheck],
      ["Absent today", String(data.absent), UserRoundX],
      ["Total fees", money(data.fees.total), WalletCards],
      ["Collected fees", money(data.fees.collected), IndianRupee],
      ["Pending fees", money(data.fees.pending), ReceiptIndianRupee],
      ["Overdue fees", money(data.fees.overdue), TrendingUp],
    ] as const,
    max = Math.max(...data.monthly.map((x) => x.amount), 1);
  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="label">{today}</p>
          <h1 className="mt-2 text-3xl font-black">
            Good morning, {firstName}
          </h1>
          <p className="mt-1 text-muted">
            Live operations and fee collection across your institution.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/attendance" className="btn-secondary">
            Mark attendance
          </Link>
          <Link href="/dashboard/students" className="btn-primary">
            + Add student
          </Link>
        </div>
      </div>
      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(([label, value, Icon]) => (
          <article className="card p-5" key={label}>
            <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand">
              <Icon className="size-5" />
            </span>
            <p className="mt-5 text-sm text-muted">{label}</p>
            <b className="mt-1 block text-2xl">{value}</b>
          </article>
        ))}
      </section>
      <section className="mt-5 grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-sm text-muted">Today&apos;s collection</p>
          <b className="mt-2 block text-2xl">{money(data.collections.today)}</b>
        </div>
        <div className="card p-5">
          <p className="text-sm text-muted">This month</p>
          <b className="mt-2 block text-2xl">{money(data.collections.month)}</b>
        </div>
        <div className="card p-5">
          <p className="text-sm text-muted">Total transactions</p>
          <b className="mt-2 block text-2xl">{data.collections.transactions}</b>
        </div>
      </section>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <article className="card p-6">
          <h2 className="text-lg font-bold">Monthly fee collection</h2>
          <p className="text-sm text-muted">Successful student fee payments</p>
          {data.monthly.length ? (
            <>
              <div className="mt-8 flex h-60 items-end gap-3 border-b border-l px-4">
                {data.monthly.map((x) => (
                  <div
                    key={x.month}
                    className="group relative flex h-full flex-1 items-end"
                  >
                    <span
                      className="w-full rounded-t-md bg-brand/80"
                      style={{
                        height: `${Math.max(5, (x.amount / max) * 100)}%`,
                      }}
                    />
                    <span className="absolute -top-4 hidden whitespace-nowrap text-xs group-hover:block">
                      {money(x.amount)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-around text-xs text-muted">
                {data.monthly.map((x) => (
                  <span key={x.month}>{x.month}</span>
                ))}
              </div>
            </>
          ) : (
            <div className="grid h-64 place-items-center text-sm text-muted">
              Collection analytics will appear after the first payment.
            </div>
          )}
        </article>
        <article className="card p-6">
          <h2 className="text-lg font-bold">Paid vs pending</h2>
          <p className="text-sm text-muted">Fee collection progress</p>
          {data.fees.total > 0 ? (
            <>
              <div
                className="mx-auto my-8 grid size-44 place-items-center rounded-full"
                style={{
                  background: `conic-gradient(hsl(var(--brand)) 0 ${(data.fees.collected / data.fees.total) * 100}%,hsl(var(--line)) 0)`,
                }}
              >
                <div className="grid size-32 place-items-center rounded-full bg-panel text-center">
                  <div>
                    <b className="text-3xl">
                      {Math.round(
                        (data.fees.collected / data.fees.total) * 100,
                      )}
                      %
                    </b>
                    <small className="block text-muted">Collected</small>
                  </div>
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span>
                  Paid <b>{money(data.fees.collected)}</b>
                </span>
                <span>
                  Pending <b>{money(data.fees.pending)}</b>
                </span>
              </div>
            </>
          ) : (
            <div className="grid h-64 place-items-center text-sm text-muted">
              Add student fee invoices to see analytics.
            </div>
          )}
        </article>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <article className="card p-6">
          <div className="flex justify-between">
            <div>
              <h2 className="text-lg font-bold">Recent fee payments</h2>
              <p className="text-sm text-muted">
                Latest successful transactions
              </p>
            </div>
            <Link
              href="/dashboard/payment-history"
              className="text-sm font-bold text-brand"
            >
              View all
            </Link>
          </div>
          <div className="mt-4 divide-y">
            {data.recentPayments.map((p) => (
              <div
                className="flex items-center justify-between py-3"
                key={p.id}
              >
                <div>
                  <b className="text-sm">{p.studentName}</b>
                  <p className="text-xs text-muted">
                    {p.className}-{p.section} · {p.method} · {p.paymentDate}
                  </p>
                </div>
                <div className="text-right">
                  <b className="text-emerald-600">+{money(p.amount)}</b>
                  <p className="text-xs text-muted">{p.receiptNumber}</p>
                </div>
              </div>
            ))}
            {!data.recentPayments.length && (
              <p className="py-10 text-center text-sm text-muted">
                No payments recorded yet.
              </p>
            )}
          </div>
        </article>
        <article className="card p-6">
          <h2 className="text-lg font-bold">Recent activity</h2>
          <p className="text-sm text-muted">
            Database-backed administration log
          </p>
          <div className="mt-4 divide-y">
            {(
              data.activities as {
                id: string;
                title: string;
                description: string;
                timestamp: string;
              }[]
            ).map((a) => (
              <div className="py-3" key={a.id}>
                <b className="text-sm">{a.title}</b>
                <p className="text-xs text-muted">
                  {a.description} ·{" "}
                  {new Date(a.timestamp + "Z").toLocaleString("en-IN")}
                </p>
              </div>
            ))}
            {!data.activities.length && (
              <p className="py-10 text-center text-sm text-muted">
                No recent activity.
              </p>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
