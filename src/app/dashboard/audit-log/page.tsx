import { AuditLogDashboard } from "@/components/audit-log-dashboard";
import {
  accountsSummary,
  getInstitution,
  listAuditLogs,
} from "@/lib/db";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";

export default async function Page() {
  const user = await requireUser();
  const institution = await getInstitution(user.institutionId);
  const start = Number(institution.academicYear.slice(0, 4));
  const years = [
    `${start - 1}-${start}`,
    institution.academicYear,
    `${start + 1}-${start + 2}`,
  ];
  const logs = await listAuditLogs(user.institutionId, 500);
  const summary = await accountsSummary(
    user.institutionId,
    institution.academicYear,
  );

  // Database rows can have a custom prototype and `details` can contain values
  // that React cannot serialize across the Server/Client Component boundary.
  const initialLogs = logs.map((log) => ({
    id: String(log.id),
    action: String(log.action),
    entity: String(log.entity),
    entityId: log.entityId == null ? null : String(log.entityId),
    createdAt: String(log.createdAt),
    userName: log.userName == null ? null : String(log.userName),
  }));
  const initialSummary = {
    totalIncome: Number(summary.totalIncome ?? 0),
    totalExpenses: Number(summary.totalExpenses ?? 0),
    netProfitLoss: Number(summary.netProfitLoss ?? 0),
  };

  return (
    <AuditLogDashboard
      initialLogs={initialLogs}
      initialSummary={initialSummary}
      years={years}
      activeYear={institution.academicYear}
    />
  );
}
