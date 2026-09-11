import { NextResponse } from "next/server";
import { z } from "zod";
import { listTeachers, saveTeacher } from "@/lib/db";
import { currentUser } from "@/lib/session";
export const runtime = "nodejs";
const teacherSchema = z.object({
  name: z.string().trim().min(2),
  employeeId: z.string().trim().min(2),
  email: z.union([z.literal(""), z.string().email()]),
  phone: z.string().trim().min(8),
  department: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  classes: z.string().trim(),
  joiningDate: z.string().min(10),
  salary: z.coerce.number().min(0),
  status: z.enum(["Active", "Inactive", "On Leave"]),
});
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  return NextResponse.json({
    teachers: await listTeachers(
      user.institutionId,
      new URL(request.url).searchParams.get("search") || "",
    ),
  });
}
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!["SCHOOL_ADMIN", "SUPER_ADMIN"].includes(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = teacherSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid teacher" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      { teacher: await saveTeacher(user.institutionId, parsed.data, user.id) },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "Employee ID already exists." },
      { status: 409 },
    );
  }
}
