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
  getInstitution,
  listPromotionHistory,
  dashboardData,
  getSchoolAsset,
  getCompleteSettings,
  adminSalaryData,
} from "@/lib/db";
import { moduleConfigs } from "@/config/modules";
import { createFinancialReportPdf } from "@/lib/financial-report-pdf";
export const runtime = "nodejs";
const exportTypeAliases: Record<string, string> = {
  receipts: "payments",
  "fee-receipts": "payments",
  "payment-history": "payments",
};
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
    !["SCHOOL_ADMIN", "SUPER_ADMIN", "ACCOUNTANT", "STAFF", "TEACHER"].includes(user.role)
  )
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const q = new URL(request.url).searchParams,
    requestedType = (q.get("type") || "students").trim().toLowerCase(),
    type = exportTypeAliases[requestedType] || requestedType,
    format = q.get("format") === "pdf" ? "pdf" : q.get("format") === "csv" ? "csv" : "xlsx",
    template = q.get("template") === "1";
  const financeTypes=new Set(["fees","reports","payments"]),adminOnlyTypes=new Set(["teachers","promotions","settings"]);if(financeTypes.has(type)&&!["SCHOOL_ADMIN","SUPER_ADMIN","ACCOUNTANT"].includes(user.role))return NextResponse.json({error:"Forbidden"},{status:403});if(adminOnlyTypes.has(type)&&!["SCHOOL_ADMIN","SUPER_ADMIN"].includes(user.role))return NextResponse.json({error:"Forbidden"},{status:403});if(type==="dashboard"&&!["SCHOOL_ADMIN","SUPER_ADMIN","ACCOUNTANT"].includes(user.role))return NextResponse.json({error:"Forbidden"},{status:403});
  if(type==="promotions"&&!['SCHOOL_ADMIN','SUPER_ADMIN'].includes(user.role))return NextResponse.json({error:"Forbidden"},{status:403});
  let rows: unknown[] = [];
  if (template) {
    if (!templates[type])
      return NextResponse.json(
        { error: `Import templates are not available for "${requestedType}".` },
        { status: 400 },
      );
    rows = templates[type];
  }
  else if (type === "students")
    rows = await listStudents(user.institutionId, {
      search: q.get("search") || undefined,
      className: q.get("class") || undefined,
      section: q.get("section") || undefined,
      fee: q.get("status") || undefined,
      academicYear:q.get("year")||undefined,
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
      academicYear:q.get("year")||undefined,
    });
  else if (type === "fees" || type === "reports")
    rows = await listFees(user.institutionId, {
      search: q.get("search") || undefined,
      className: q.get("class") || undefined,
      section: q.get("section") || undefined,
      status: q.get("status") || undefined,
      academicYear: q.get("year") || undefined,
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
      academicYear: q.get("year") || undefined,
    });
  else if(type==="promotions")rows=await listPromotionHistory(user.institutionId,q.get("search")||"");
  else if(type==="dashboard"){const data=await dashboardData(user.institutionId);rows=[{metric:"Students",value:data.students},{metric:"Teachers",value:data.teachers},{metric:"Present Today",value:data.present},{metric:"Absent Today",value:data.absent},{metric:"Total Fees",value:data.fees.total},{metric:"Collected Fees",value:data.fees.collected},{metric:"Pending Fees",value:data.fees.pending},{metric:"Overdue Fees",value:data.fees.overdue},{metric:"Today's Collection",value:data.collections.today},{metric:"This Month",value:data.collections.month},{metric:"Transactions",value:data.collections.transactions}]}
  else if(type==="settings"){
    const s=await getCompleteSettings(user.institutionId);
    rows=[
      {section:"General",setting:"School Name",value:s.name},{section:"General",setting:"School Type",value:s.schoolType},{section:"General",setting:"Address",value:s.address},{section:"General",setting:"City / State / PIN",value:[s.city,s.state,s.pinCode].filter(Boolean).join(", ")},{section:"General",setting:"DISE / UDISE Code",value:s.diseCode},{section:"General",setting:"Phone",value:s.phone},{section:"General",setting:"Email",value:s.email},{section:"General",setting:"Website",value:s.website},
      {section:"Administration",setting:"Principal",value:s.principalName},{section:"Administration",setting:"Registration Number",value:s.registrationNumber},{section:"Administration",setting:"Affiliation",value:s.affiliation},{section:"Administration",setting:"Motto",value:s.motto},
      {section:"Academic",setting:"Active Academic Year",value:s.academicYear},...s.years.map(y=>({section:"Academic Year",setting:y.name,value:`${y.status}; months ${y.startMonth} to ${y.endMonth}${y.name===s.academicYear?"; currently active":""}`})),...s.classes.filter(c=>c.active).map(c=>({section:"Class",setting:c.name,value:c.sections.length?`Sections: ${c.sections.join(", ")}`:"No sections"})),
      {section:"Templates",setting:"Fee Receipt Title",value:s.feeReceiptTitle},{section:"Templates",setting:"Fee Receipt Sub-header",value:s.feeReceiptSubheader},{section:"Templates",setting:"Pay Slip Title",value:s.payslipTitle},{section:"Templates",setting:"Pay Slip Sub-header",value:s.payslipSubheader},{section:"Templates",setting:"Signature Label",value:s.signatureLabel},{section:"Templates",setting:"Footer Text",value:s.footerText},
      {section:"Assets",setting:"School Logo",value:s.logoUrl?"Uploaded and included in PDFs":"Not uploaded"},{section:"Assets",setting:"Authorized Signature",value:s.signatureUrl?"Uploaded and used on receipts":"Not uploaded"},
    ];
  }
  else if(type==="salary-management"){
    const salary=await adminSalaryData({school:user.institutionId,search:q.get("search")||undefined,status:q.get("status")||undefined,month:Number(q.get("month"))||undefined,year:Number(q.get("year"))||undefined,limit:10000});
    const rupees=(value:unknown)=>Number(value||0)/100;
    rows=salary.items.map(item=>({...item,basic:rupees(item.basicPaise),gross:rupees(item.grossPaise),deductions:rupees(item.totalDeductionsPaise),netSalary:rupees(item.netPaise),paidAmount:rupees(item.paidPaise),pendingAmount:rupees(item.netPaise)-rupees(item.paidPaise)}));
  }
  else if (moduleConfigs[type])
    rows = await listModuleRecords(user.institutionId, type);
  else
    return NextResponse.json(
      { error: `Unsupported export type "${requestedType}".` },
      { status: 400 },
    );
  if (format === "pdf") {
    if (template)
      return NextResponse.json({ error: "PDF is available for saved records, not blank import templates." }, { status: 400 });
    const [school,asset]=await Promise.all([getInstitution(user.institutionId),getSchoolAsset(user.institutionId,"logo")]),model=pdfModel(type,rows as Record<string,unknown>[]),activeFilters=[q.get("search")&&`Search: ${q.get("search")}`,q.get("class")&&`Class: ${q.get("class")}`,q.get("section")&&`Section: ${q.get("section")}`,q.get("status")&&`Status: ${q.get("status")}`,q.get("method")&&`Method: ${q.get("method")}`,q.get("date")&&`Date: ${q.get("date")}`,q.get("from")&&`From: ${q.get("from")}`,q.get("to")&&`To: ${q.get("to")}`].filter(Boolean) as string[];
    try {
      const data=await createFinancialReportPdf({title:model.title,academicYear:q.get("year")||school.academicYear,school:{...school,logo:asset?{mimeType:asset.mimeType,data:new Uint8Array(asset.data)}:undefined},columns:model.columns,rows:model.rows,totals:[{label:"Total Records",value:String(model.rows.length)}],filters:activeFilters});
      await logExport(user.institutionId,user.id,`${type} PDF`,model.rows.length);
      return new Response(Buffer.from(data),{headers:{"Content-Type":"application/pdf","Content-Disposition":`inline; filename="EduLedger_${safeName(model.title)}_${q.get("year")||school.academicYear}.pdf"`,"Cache-Control":"private, no-store"}});
    } catch {
      return NextResponse.json({error:"Could not generate the PDF export."},{status:500});
    }
  }
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

const pdfFields:Record<string,[string,string][]>={
 students:[["_serial","Sl. No."],["admission","Admission No."],["name","Student Name"],["parent","Father / Guardian"],["dateOfBirth","Date of Birth"],["gender","Gender"],["className","Class"],["section","Section"],["academicYear","Academic Year"],["status","Status"]],
 teachers:[["employeeId","Employee ID"],["name","Teacher Name"],["department","Department"],["subject","Subject"],["classes","Assigned Classes"],["phone","Phone"],["email","Email"],["joiningDate","Joining Date"],["status","Status"]],
 classes:[["name","Class"],["section","Section"],["academicYear","Academic Year"],["teacher","Class Teacher"],["currentStudents","Students"],["capacity","Capacity"],["status","Status"]],
 attendance:[["date","Date"],["studentName","Student Name"],["admission","Admission No."],["className","Class"],["section","Section"],["status","Status"],["remarks","Remarks"]],
 fees:[["invoiceNumber","Invoice"],["studentName","Student Name"],["admission","Admission"],["className","Class"],["section","Section"],["feeType","Fee Type"],["totalAmount","Total"],["paidAmount","Paid"],["pendingAmount","Balance"],["status","Status"]],
 reports:[["invoiceNumber","Invoice"],["studentName","Student Name"],["admission","Admission"],["className","Class"],["feeType","Fee Type"],["totalAmount","Total"],["paidAmount","Paid"],["pendingAmount","Balance"],["status","Status"]],
 payments:[["receiptNumber","Receipt"],["paymentDate","Date"],["studentName","Student Name"],["admission","Admission"],["className","Class"],["section","Section"],["method","Mode"],["transactionId","Transaction ID"],["amount","Amount"],["status","Status"]],
 promotions:[["studentName","Student"],["admission","Admission"],["previousYear","Previous Year"],["previousClass","Previous Class"],["newYear","New Year"],["newClass","New Class"],["promotedBy","Promoted By"],["promotedAt","Promoted Date"]],
 dashboard:[["metric","Dashboard Metric"],["value","Value"]],
 settings:[["section","Section"],["setting","Setting"],["value","Saved Value"]],
 "salary-management":[["payslipNumber","Slip #"],["employeeName","Employee"],["employeeId","Employee ID"],["role","Role"],["month","Month"],["year","Year"],["basic","Basic Salary"],["netSalary","Net Salary"],["paidAmount","Paid"],["paymentStatus","Status"]],
};
function pdfModel(type:string,source:Record<string,unknown>[]){const configured=pdfFields[type],fallbackKeys=source[0]?Object.keys(source[0]).filter(key=>key!=="id").slice(0,10):moduleConfigs[type]?.fields.map(field=>field.key).slice(0,10)||[],fields=(configured||fallbackKeys.map(key=>[key,label(key)] as [string,string])).slice(0,10),columnWidth=519/Math.max(fields.length,1),rows=source.map((item,index)=>Object.fromEntries(fields.map(([key])=>[key,key==="_serial"?index+1:display(item[key])])));return{title:type==="payments"?"Payment History":type==="fees"||type==="reports"?"Fee Structure":type==="dashboard"?"Dashboard Summary":type==="settings"?"Institution Settings Report":`${label(type)} Report`,rows,columns:fields.map(([key,name])=>({key,label:name,width:columnWidth,align:/amount|paid|balance|total|capacity/i.test(key)?"right" as const:"left" as const}))}}
function label(value:string){return value.replace(/[-_]/g," ").replace(/\b\w/g,character=>character.toUpperCase())}
function display(value:unknown){if(value===null||value===undefined||value==="")return "-";if(typeof value==="number")return value.toLocaleString("en-IN");if(typeof value==="object")return JSON.stringify(value);return String(value)}
function safeName(value:string){return value.replace(/[^A-Za-z0-9]+/g,"_").replace(/^_|_$/g,"")}
