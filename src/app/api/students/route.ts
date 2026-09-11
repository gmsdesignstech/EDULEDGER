import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addStudent,
  assertStudentCapacity,
  getInstitution,
  listStudents,
} from "@/lib/db";
import { currentUser } from "@/lib/session";
import {
  explainCapacityError,
  subscriptionAccessError,
} from "@/lib/subscription-access";
export const runtime = "nodejs";
const studentInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  admission: z.string().trim().min(2).max(40),
  gender: z.enum(["Male", "Female", "Other"]),
  dateOfBirth: z.string().min(10),
  className: z.string().trim().min(1).max(40),
  section: z.string().trim().min(1).max(10),
  rollNumber: z.string().trim().max(30),
  parent: z.string().trim().min(2).max(100),
  parentPhone: z
    .string()
    .trim()
    .regex(/^$|^[+\d][\d\s-]{7,16}$/, "Enter a valid phone number"),
  parentEmail: z.union([z.literal(""), z.string().email()]),
  address: z.string().trim().max(500),
  admissionDate: z.string().min(10),
  totalFee: z.coerce.number().min(0).max(100000000),
  academicYear: z.string().trim().min(4).max(20),
  dueDate: z.string().min(10),
});
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const q = new URL(request.url).searchParams;
  const students = await listStudents(user.institutionId, {
    search: q.get("search") || undefined,
    className: q.get("class") || undefined,
    section: q.get("section") || undefined,
    fee: q.get("fee") || undefined,
    limit: q.get("limit") ? Number(q.get("limit")) : undefined,
    offset: q.get("offset") ? Number(q.get("offset")) : undefined,
  });
  return NextResponse.json({
    students,
    academicYear: (await getInstitution(user.institutionId)).academicYear,
  });
}
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!["SCHOOL_ADMIN", "SUPER_ADMIN", "STAFF"].includes(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const access = await subscriptionAccessError(user.institutionId);
  if (access) return NextResponse.json(access, { status: access.status });
  const parsed = studentInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid student details" },
      { status: 400 },
    );
  try {
    await assertStudentCapacity(user.institutionId);
    return NextResponse.json(
      { student: await addStudent(user.institutionId, parsed.data, user.id) },
      { status: 201 },
    );
  } catch (error) {
    const capacity = explainCapacityError(error),
      message =
        capacity ||
        (error instanceof Error && error.message.includes("UNIQUE")
          ? "That admission number already exists."
          : "Could not save the student.");
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
