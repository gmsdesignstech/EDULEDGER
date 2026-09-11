import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { currentUser } from "@/lib/session";
import {
  listAttendance,
  listClasses,
  listFees,
  listModuleRecords,
  listPayments,
  listStudents,
  listTeachers,
  logExport,
} from "@/lib/db";
export const runtime = "nodejs";
const templates: Record<string, Record<string, string>[]> = {
  students: [
    {
      "Student Name": "",
      "Admission Number": "",
      Gender: "Male",
      "Date of Birth": "YYYY-MM-DD",
      Class: "",
      Section: "",
      "Roll Number": "",
      "Parent Name": "",
      "Parent Phone": "",
      "Parent Email": "",
      Address: "",
      "Admission Date": "YYYY-MM-DD",
      "Total Annual Fee": "",
      "Due Date": "YYYY-MM-DD",
    },
  ],
  teachers: [
    {
      "Teacher Name": "",
      "Employee ID": "",
      Email: "",
      Phone: "",
      Department: "",
      "Primary Subject": "",
      "Assigned Classes": "",
      "Joining Date": "YYYY-MM-DD",
      Salary: "",
      Status: "Active",
    },
  ],
  classes: [
    {
      "Class Name": "",
      Section: "",
      "Class Teacher": "",
      "Academic Year": "2026-2027",
      Capacity: "40",
      Status: "Active",
    },
  ],
  attendance: [
    {
      "Admission Number": "",
      Date: "YYYY-MM-DD",
      Status: "Present",
      Remarks: "",
    },
  ],
  fees: [
    {
      "Admission Number": "",
      "Fee Type": "Annual Fee",
      "Academic Year": "2026-2027",
      "Total Amount": "",
      "Due Date": "YYYY-MM-DD",
    },
  ],
  reports: [
    {
      "Admission Number": "",
      "Fee Type": "Annual Fee",
      "Academic Year": "2026-2027",
      "Total Amount": "",
      "Due Date": "YYYY-MM-DD",
    },
  ],
  payments: [
    {
      "Admission Number": "",
      "Invoice Number": "",
      Amount: "",
      "Payment Method": "Cash",
      "Payment Date": "YYYY-MM-DD",
      "Transaction ID": "",
      Notes: "",
    },
  ],
  assignments: [
    {
      "Assignment Title": "",
      Class: "",
      "Due Date": "YYYY-MM-DD",
      Status: "Published",
    },
  ],
  messages: [{ Recipient: "", Subject: "", Message: "", Status: "Sent" }],
};
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (
    !["SCHOOL_ADMIN", "SUPER_ADMIN", "ACCOUNTANT", "STAFF"].includes(user.role)
  )
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = new URL(request.url).searchParams,
    type = q.get("type") || "students",
    format = q.get("format") === "csv" ? "csv" : "xlsx",
    template = q.get("template") === "1";
  let rows: unknown[] = [];
  if (template) rows = templates[type] || [];
  else if (type === "students")
    rows = await listStudents(user.institutionId, {
      search: q.get("search") || undefined,
      className: q.get("class") || undefined,
      section: q.get("section") || undefined,
      fee: q.get("status") || undefined,
    });
  else if (type === "teachers")
    rows = await listTeachers(user.institutionId, q.get("search") || "");
  else if (type === "classes")
    rows = await listClasses(user.institutionId, q.get("year") || undefined);
  else if (type === "attendance")
    rows = await listAttendance(user.institutionId, {
      date: q.get("date") || undefined,
      className: q.get("class") || undefined,
      section: q.get("section") || undefined,
      status: q.get("status") || undefined,
    });
  else if (type === "fees" || type === "reports")
    rows = await listFees(user.institutionId, {
      search: q.get("search") || undefined,
      className: q.get("class") || undefined,
      section: q.get("section") || undefined,
      status: q.get("status") || undefined,
    });
  else if (type === "payments")
    rows = await listPayments(user.institutionId, {
      search: q.get("search") || undefined,
      className: q.get("class") || undefined,
      section: q.get("section") || undefined,
      method: q.get("method") || undefined,
      status: q.get("status") || undefined,
      from: q.get("from") || undefined,
      to: q.get("to") || undefined,
    });
  else if (type === "assignments" || type === "messages")
    rows = await listModuleRecords(user.institutionId, type);
  else
    return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
  const sheet = XLSX.utils.json_to_sheet(rows as Record<string, unknown>[]),
    book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "EduLedger");
  const data =
    format === "csv"
      ? XLSX.utils.sheet_to_csv(sheet)
      : XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  if (!template) await logExport(user.institutionId, user.id, type, rows.length);
  const filename = `${template ? `${type}-import-template` : type}-${new Date().toISOString().slice(0, 10)}.${format}`;
  return new Response(data, {
    headers: {
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
