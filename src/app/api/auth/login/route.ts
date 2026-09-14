import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { compare } from "bcryptjs";
import { z } from "zod";
import { createSession, findUserByEmail, recordUserLogin } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
import { logServerError } from "@/lib/server-errors";
export const runtime = "nodejs";
const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
});
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Enter a valid email and password." },
      { status: 400 },
    );
  try {
    const user = await findUserByEmail(parsed.data.email);
    if (!user || user.status!=="Active" || !(await compare(parsed.data.password, user.passwordHash)))
      return NextResponse.json(
        { error: "Email or password is incorrect." },
        { status: 401 },
      );
    const session = await createSession(user.id);
    await recordUserLogin(user.id);
    (await cookies()).set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expires,
    });
    return NextResponse.json({
      user: { name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    logServerError("auth.login", error);
    return NextResponse.json(
      { error: "The sign-in service is temporarily unavailable. Please try again." },
      { status: 500 },
    );
  }
}
