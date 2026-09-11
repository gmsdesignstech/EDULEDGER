import { NextResponse } from "next/server";
import { dashboardData } from "@/lib/db";
import { currentUser } from "@/lib/session";
export const runtime = "nodejs";
export async function GET() {
  const user = await currentUser();
  return user
    ? NextResponse.json(await dashboardData(user.institutionId))
    : NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
}
