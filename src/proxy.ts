import { NextResponse, type NextRequest } from "next/server";
import { getUserBySession } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
import { subscriptionAccessError } from "@/lib/subscription-access";
const allowedPrefixes = [
  "/api/auth/",
  "/api/subscription/",
  "/api/payments/verify",
  "/api/settings",
  "/api/health",
  "/api/admin",
];
export async function proxy(request: NextRequest) {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
    allowedPrefixes.some((prefix) =>
      request.nextUrl.pathname.startsWith(prefix),
    )
  )
    return NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value,
    user = token ? await getUserBySession(token) : undefined;
  if (!user) return NextResponse.next();
  const access = await subscriptionAccessError(user.institutionId);
  return access
    ? NextResponse.json(access, { status: access.status })
    : NextResponse.next();
}
export const config = { matcher: "/api/:path*" };
