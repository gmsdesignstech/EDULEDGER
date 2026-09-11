import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteTeacher, updateTeacher } from "@/lib/db";
import { currentUser } from "@/lib/session";
export const runtime = "nodejs";
const teacherSchema = z.object({
  name: z.string().trim().min(2),
  employeeId: z.string().trim().min(2),
  email: z.string(),
  phone: z.string().trim().min(8),
  department: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  classes: z.string(),
  joiningDate: z.string().min(10),
  salary: z.coerce.number().min(0),
  status: z.enum(["Active", "Inactive", "On Leave"]),
});
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = teacherSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid teacher" },
      { status: 400 },
    );
  const teacher = await updateTeacher(
    user.institutionId,
    (await params).id,
    parsed.data,
    user.id,
  );
  return teacher
    ? NextResponse.json({ teacher })
    : NextResponse.json({ error: "Teacher not found" }, { status: 404 });
}
export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  return (await deleteTeacher(user.institutionId, (await params).id, user.id))
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "Teacher not found" }, { status: 404 });
}
