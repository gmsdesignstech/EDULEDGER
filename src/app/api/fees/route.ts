import { NextResponse } from "next/server";
import { listFees } from "@/lib/db";
import { currentUser } from "@/lib/session";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const q = new URL(request.url).searchParams;
  return NextResponse.json({
    fees: await listFees(user.institutionId, {
      search: q.get("search") || undefined,
      className: q.get("class") || undefined,
      section: q.get("section") || undefined,
      status: q.get("status") || undefined,
    }),
  });
}
