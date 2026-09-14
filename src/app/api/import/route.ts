import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addModuleRecord,
  addStudent as addStudentUnsafe,
  assertStudentCapacity,
  createFee,
  findStudentByAdmission,
  getInstitution,
  listFees,
  logImport,
  markAttendance,
  recordPayment,
  saveClass,
  saveTeacher,
} from "@/lib/db";
import { currentUser } from "@/lib/session";
import { explainCapacityError } from "@/lib/subscription-access";
export const runtime = "nodejs";
const addStudent = async (...args: Parameters<typeof addStudentUnsafe>) => {
  await assertStudentCapacity(args[0]);
  return await addStudentUnsafe(...args);
};
const requestSchema = z.object({
  type: z.enum([
    "students",
    "teachers",
    "classes",
    "attendance",
    "fees",
    "reports",
    "payments",
    "assignments",
    "messages",
  ]),
  rows: z
    .array(z.record(z.union([z.string(), z.number(), z.null()])))
    .min(1)
    .max(2000),
});
type Row = Record<string, string | number | null>;
const s = (row: Row, key: string) => String(row[key] ?? "").trim(),
  n = (row: Row, key: string) => Number(row[key] ?? 0);
function requiredFor(type: string) {
  if (type === "students")
    return [
      "Student Name",
      "Admission Number",
      "Gender",
      "Date of Birth",
      "Class",
      "Section",
      "Parent Name",
      "Admission Date",
      "Due Date",
    ];
  if (type === "teachers")
    return [
      "Teacher Name",
      "Employee ID",
      "Phone",
      "Department",
      "Primary Subject",
      "Joining Date",
    ];
  if (type === "classes") return ["Class Name", "Section", "Academic Year"];
  if (type === "attendance") return ["Admission Number", "Date", "Status"];
  if (type === "payments")
    return [
      "Admission Number",
      "Invoice Number",
      "Amount",
      "Payment Method",
      "Payment Date",
    ];
  if (type === "assignments")
    return ["Assignment Title", "Class", "Due Date", "Status"];
  if (type === "messages") return ["Recipient", "Subject", "Message", "Status"];
  return ["Admission Number", "Total Amount", "Due Date"];
}
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!["SCHOOL_ADMIN", "SUPER_ADMIN", "ACCOUNTANT"].includes(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "Invalid import. Use a supported template with no more than 2,000 rows.",
      },
      { status: 400 },
    );
  const { type, rows } = parsed.data,
    errors: { row: number; message: string }[] = [],
    valid: Row[] = [];
  const defaultAcademicYear=(await getInstitution(user.institutionId)).academicYear;
  if (type === "students") {
    try {
      await assertStudentCapacity(user.institutionId, rows.length);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            explainCapacityError(error) || "Student capacity check failed.",
        },
        { status: 409 },
      );
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i],
      missing = requiredFor(type).find((key) => !s(row, key));
    if (missing) {
      errors.push({ row: i + 2, message: `${missing} is required.` });
      continue;
    }
    if (
      type === "students" &&
      (await findStudentByAdmission(user.institutionId, s(row, "Admission Number")))
    ) {
      errors.push({ row: i + 2, message: "Admission number already exists." });
      continue;
    }
    if (
      ["fees", "reports", "attendance", "payments"].includes(type) &&
      !(await findStudentByAdmission(user.institutionId, s(row, "Admission Number")))
    ) {
      errors.push({ row: i + 2, message: "Admission number was not found." });
      continue;
    }
    if (
      type === "attendance" &&
      !["Present", "Absent", "Late", "Leave"].includes(s(row, "Status"))
    ) {
      errors.push({
        row: i + 2,
        message: "Status must be Present, Absent, Late or Leave.",
      });
      continue;
    }
    if (
      type === "payments" &&
      !["Cash", "UPI", "Card", "Bank Transfer", "Online", "Other"].includes(
        s(row, "Payment Method"),
      )
    ) {
      errors.push({ row: i + 2, message: "Unsupported payment method." });
      continue;
    }
    valid.push(row);
  }
  let imported = 0;
  for (const row of valid) {
    try {
      if (type === "students")
        await addStudent(
          user.institutionId,
          {
            name: s(row, "Student Name"),
            admission: s(row, "Admission Number"),
            gender: s(row, "Gender") as "Male" | "Female" | "Other",
            dateOfBirth: s(row, "Date of Birth"),
            className: s(row, "Class"),
            section: s(row, "Section"),
            rollNumber: s(row, "Roll Number"),
            parent: s(row, "Parent Name"),
            parentPhone: s(row, "Parent Phone"),
            parentEmail: s(row, "Parent Email"),
            address: s(row, "Address"),
            admissionDate: s(row, "Admission Date"),
            totalFee: n(row, "Total Annual Fee"),
            academicYear: s(row, "Academic Year") || defaultAcademicYear,
            dueDate: s(row, "Due Date"),
          },
          user.id,
        );
      else if (type === "teachers")
        await saveTeacher(
          user.institutionId,
          {
            name: s(row, "Teacher Name"),
            employeeId: s(row, "Employee ID"),
            email: s(row, "Email"),
            phone: s(row, "Phone"),
            department: s(row, "Department"),
            subject: s(row, "Primary Subject"),
            classes: s(row, "Assigned Classes"),
            joiningDate: s(row, "Joining Date"),
            salary: n(row, "Salary"),
            status: s(row, "Status") || "Active",
          },
          user.id,
        );
      else if (type === "classes")
        await saveClass(
          user.institutionId,
          {
            name: s(row, "Class Name"),
            section: s(row, "Section"),
            teacher: s(row, "Class Teacher"),
            academicYear: s(row, "Academic Year"),
            capacity: n(row, "Capacity") || 40,
            status: s(row, "Status") || "Active",
          },
          user.id,
        );
      else if (type === "fees" || type === "reports") {
        const student = await findStudentByAdmission(
          user.institutionId,
          s(row, "Admission Number"),
        )!;
        await createFee(
          user.institutionId,
          student.id,
          {
            feeType: s(row, "Fee Type") || "Annual Fee",
            academicYear: s(row, "Academic Year") || defaultAcademicYear,
            totalAmount: n(row, "Total Amount"),
            dueDate: s(row, "Due Date"),
          },
          user.id,
        );
      } else if (type === "attendance") {
        const student = await findStudentByAdmission(
          user.institutionId,
          s(row, "Admission Number"),
        )!;
        await markAttendance(
          user.institutionId,
          s(row, "Date"),
          [
            {
              studentId: student.id,
              status: s(row, "Status"),
              remarks: s(row, "Remarks"),
            },
          ],
          user.name,
          user.id,
        );
      } else if (type === "payments") {
        const fee = (await listFees(user.institutionId, {
          search: s(row, "Invoice Number"),
        })).find(
          (item) =>
            item.invoiceNumber === s(row, "Invoice Number") &&
            item.admission === s(row, "Admission Number"),
        );
        if (!fee) throw new Error("Invoice not found");
        await recordPayment(user.institutionId, user.id, {
          feeId: String(fee.id),
          amount: n(row, "Amount"),
          method: s(row, "Payment Method"),
          paymentDate: s(row, "Payment Date"),
          transactionId: s(row, "Transaction ID"),
          notes: s(row, "Notes"),
        });
      } else if (type === "assignments")
        await addModuleRecord(user.institutionId, "assignments", {
          title: s(row, "Assignment Title"),
          class: s(row, "Class"),
          due: s(row, "Due Date"),
          status: s(row, "Status"),
        });
      else
        await addModuleRecord(user.institutionId, "messages", {
          recipient: s(row, "Recipient"),
          subject: s(row, "Subject"),
          message: s(row, "Message"),
          status: s(row, "Status"),
        });
      imported++;
    } catch (error) {
      errors.push({
        row: rows.indexOf(row) + 2,
        message:
          error instanceof Error && error.message.includes("UNIQUE")
            ? "Duplicate record."
            : error instanceof Error
              ? error.message
              : "Could not import this row.",
      });
    }
  }
  if (imported) await logImport(user.institutionId, user.id, type, imported);
  return NextResponse.json({
    total: rows.length,
    valid: valid.length,
    invalid: errors.length,
    imported,
    skipped: rows.length - imported,
    errors,
  });
}
