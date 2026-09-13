import { NextResponse } from "next/server";
import { z } from "zod";
import { addClassSection, getInstitution, listClassSummaries } from "@/lib/db";
import { currentUser } from "@/lib/session";
export const runtime = "nodejs";
const schema = z.object({
  name: z.string().trim().min(1),
  section: z.string().trim().min(1),
  teacher: z.string().trim(),
  academicYear: z.string().trim().min(4),
  capacity: z.coerce.number().int().min(1),
  status: z.enum(["Active", "Inactive"]),
});
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const year = new URL(request.url).searchParams.get("year") || undefined;
  return NextResponse.json({
    classes: await listClassSummaries(user.institutionId, year),
    academicYear: (await getInstitution(user.institutionId)).academicYear,
  });
}
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!["SCHOOL_ADMIN", "SUPER_ADMIN"].includes(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid class" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      { class: await addClassSection(user.institutionId, parsed.data.name, parsed.data.academicYear, parsed.data.section, parsed.data.teacher, parsed.data.capacity, user.id) },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "This class and section already exists for the academic year." },
      { status: 409 },
    );
  }
}
