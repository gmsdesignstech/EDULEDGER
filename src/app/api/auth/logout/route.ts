import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteSession } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
import { logServerError } from "@/lib/server-errors";
export const runtime = "nodejs";
export async function POST() {
  const jar = await cookies(),
    token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  if (token)
    try {
      await deleteSession(token);
    } catch (error) {
      logServerError("auth.logout", error);
      return NextResponse.json(
        {
          error:
            "The sign-out service is temporarily unavailable. Your local session was cleared.",
        },
        { status: 500 },
      );
    }
  return NextResponse.json({ ok: true });
}
