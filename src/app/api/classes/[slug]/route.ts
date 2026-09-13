import { NextResponse } from "next/server";
import { z } from "zod";
import { addClassExam, addClassResult, addClassSection, addTimetableEntry, classFromSlug, deleteClassSection, getClassWorkspace } from "@/lib/db";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { slug } = await context.params;
  const year = new URL(request.url).searchParams.get("year") || undefined;
  const workspace = await getClassWorkspace(user.institutionId, slug, year);
  return workspace ? NextResponse.json(workspace) : NextResponse.json({ error: "Class not found" }, { status: 404 });
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("section"), section: z.string().trim().min(1).max(10), teacher: z.string().trim().max(100).default(""), capacity: z.coerce.number().int().min(1).max(500), academicYear: z.string().min(4) }),
  z.object({ action: z.literal("timetable"), section: z.string().min(1), subject: z.string().min(1), teacherId: z.string().optional(), weekday: z.coerce.number().int().min(1).max(6), startTime: z.string().min(4), endTime: z.string().min(4), academicYear: z.string().min(4) }),
  z.object({ action: z.literal("exam"), name: z.string().min(1), examDate: z.string().min(10), section: z.string().min(1), subject: z.string().min(1), maxMarks: z.coerce.number().positive(), passingMarks: z.coerce.number().min(0), academicYear: z.string().min(4) }),
  z.object({ action: z.literal("result"), examId: z.string().uuid(), studentId: z.string().uuid(), marks: z.coerce.number().min(0) }),
]);

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!["SCHOOL_ADMIN", "SUPER_ADMIN", "TEACHER"].includes(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { slug } = await context.params;
  const definition = classFromSlug(slug);
  if (!definition) return NextResponse.json({ error: "Class not found" }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid record" }, { status: 400 });
  try {
    const data = parsed.data;
    if (data.action === "section") await addClassSection(user.institutionId, definition.name, data.academicYear, data.section.toUpperCase(), data.teacher, data.capacity, user.id);
    else if (data.action === "timetable") await addTimetableEntry(user.institutionId, definition.name, data.academicYear, data);
    else if (data.action === "exam") await addClassExam(user.institutionId, definition.name, data.academicYear, data);
    else await addClassResult(user.institutionId, data.examId, data.studentId, data.marks);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save record" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!["SCHOOL_ADMIN", "SUPER_ADMIN"].includes(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("sectionId");
  if (!id) return NextResponse.json({ error: "Section is required" }, { status: 400 });
  try { await deleteClassSection(user.institutionId, id, user.id); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete section" }, { status: 409 }); }
}
