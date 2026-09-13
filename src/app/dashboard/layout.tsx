import { Shell } from "@/components/dashboard";
import { getInstitution, getSubscription } from "@/lib/db";
import { requireUser } from "@/lib/session";
export const runtime = "nodejs";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser(),
    [subscription,institution] = await Promise.all([getSubscription(user.institutionId),getInstitution(user.institutionId)]);
  return (
    <Shell
      user={{ name: user.name, role: user.role }}
      schoolName={institution.name}
      subscription={subscription}
    >
      {children}
    </Shell>
  );
}
