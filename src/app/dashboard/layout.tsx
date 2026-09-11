import { Shell } from "@/components/dashboard";
import { getSubscription } from "@/lib/db";
import { requireUser } from "@/lib/session";
export const runtime = "nodejs";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser(),
    subscription = await getSubscription(user.institutionId);
  return (
    <Shell
      user={{ name: user.name, role: user.role }}
      subscription={subscription}
    >
      {children}
    </Shell>
  );
}
