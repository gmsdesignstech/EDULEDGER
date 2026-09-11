import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { hash } from "bcryptjs";
import { z } from "zod";
import { createAccount, createSession, findUserByEmail } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/session";
export const runtime = "nodejs";
const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  institution: z.string().trim().min(2).max(150),
  password: z.string().min(8).max(128),
});
export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid account details" },
      { status: 400 },
    );
  try {
    if (await findUserByEmail(parsed.data.email))
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    const user = await createAccount({
        ...parsed.data,
        passwordHash: await hash(parsed.data.password, 12),
      }),
      session = await createSession(user.id);
    (await cookies()).set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expires,
    });
    return NextResponse.json(
      { user: { name: user.name, email: user.email, role: user.role } },
      { status: 201 },
    );
  } catch (error) {
    console.error("Registration failed", error);
    return NextResponse.json(
      { error: "The registration service is temporarily unavailable. Please try again." },
      { status: 503 },
    );
  }
}
