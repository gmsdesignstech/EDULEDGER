import "server-only";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { SUBSCRIPTION_PLANS, getPlan } from "./subscription-plans";
import {
  addOneYear,
  effectiveStatus,
  type SubscriptionStatus,
} from "./subscription";

export type DbUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  institutionId: string;
};
export type FeeStatus = "Paid" | "Partially Paid" | "Pending" | "Overdue";
export type DbStudent = {
  id: string;
  name: string;
  admission: string;
  gender: string;
  dateOfBirth: string;
  className: string;
  section: string;
  grade: string;
  rollNumber: string;
  parent: string;
  parentPhone: string;
  parentEmail: string;
  address: string;
  admissionDate: string;
  attendance: number;
  fee: FeeStatus;
  totalFee: number;
  paidFee: number;
  pendingFee: number;
  status: string;
  createdAt: string;
};
export type DbTeacher = {
  id: string;
  name: string;
  employeeId: string;
  email: string;
  phone: string;
  department: string;
  subject: string;
  classes: string;
  joiningDate: string;
  salary: number;
  status: string;
  createdAt: string;
};
export type DbClass = {
  id: string;
  name: string;
  section: string;
  teacher: string;
  academicYear: string;
  capacity: number;
  currentStudents: number;
  status: string;
};
export type DbPayment = {
  id: string;
  feeId: string;
  studentId: string;
  studentName: string;
  admission: string;
  className: string;
  section: string;
  invoiceNumber: string;
  receiptNumber: string;
  amount: number;
  method: string;
  transactionId: string;
  paymentDate: string;
  status: string;
  notes: string;
  previouslyPaid: number;
  totalPaid: number;
  remainingBalance: number;
  createdAt: string;
};
export type StudentInput = {
  name: string;
  admission: string;
  gender: string;
  dateOfBirth: string;
  className: string;
  section: string;
  rollNumber: string;
  parent: string;
  parentPhone: string;
  parentEmail: string;
  address: string;
  admissionDate: string;
  totalFee: number;
  academicYear: string;
  dueDate: string;
};
export type SubscriptionSummary = {
  status: SubscriptionStatus;
  planId: string | null;
  planName: string | null;
  studentCapacity: number | null;
  amountPaid: number;
  activationDate: string | null;
  expiryDate: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  razorpaySignature: string | null;
  studentUsage: number;
};
export type ModuleRecord = { id: string; [key: string]: string };

type Client = ReturnType<typeof postgres>;
type Sql = any;
let client: Client | undefined, initializing: Promise<void> | undefined;
function connection() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL is not configured. Connect a PostgreSQL database in Vercel.",
    );
  return (client ??= postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  }));
}
function bind(query: string) {
  let n = 0;
  return query.replace(/\?/g, () => `$${++n}`);
}
async function rows<T extends Record<string, unknown>>(
  query: string,
  args: unknown[] = [],
  sql: Sql = connection(),
) {
  return (await sql.unsafe(bind(query), args as any[])) as unknown as T[];
}
async function row<T extends Record<string, unknown>>(
  query: string,
  args: unknown[] = [],
  sql: Sql = connection(),
) {
  return (await rows<T>(query, args, sql))[0];
}
async function run(
  query: string,
  args: unknown[] = [],
  sql: Sql = connection(),
) {
  return Number((await sql.unsafe(bind(query), args as any[])).count ?? 0);
}

async function initialize() {
  if (initializing) return initializing;
  initializing = (async () => {
    const sql = connection();
    await sql.unsafe(`
CREATE TABLE IF NOT EXISTS institutions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,institution_id TEXT NOT NULL REFERENCES institutions(id),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),name TEXT NOT NULL,admission TEXT NOT NULL UNIQUE,gender TEXT NOT NULL DEFAULT '',date_of_birth TEXT NOT NULL DEFAULT '',class_name TEXT NOT NULL DEFAULT '',section TEXT NOT NULL DEFAULT '',grade TEXT NOT NULL,parent TEXT NOT NULL,roll_number TEXT NOT NULL DEFAULT '',parent_phone TEXT NOT NULL DEFAULT '',parent_email TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',admission_date TEXT NOT NULL DEFAULT '',attendance INTEGER NOT NULL DEFAULT 100,fee TEXT NOT NULL DEFAULT 'Pending',total_fee DOUBLE PRECISION NOT NULL DEFAULT 0,paid_fee DOUBLE PRECISION NOT NULL DEFAULT 0,pending_fee DOUBLE PRECISION NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'Active',created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS module_records(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL,module TEXT NOT NULL,data JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS teachers(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),name TEXT NOT NULL,employee_id TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',department TEXT NOT NULL DEFAULT '',subject TEXT NOT NULL DEFAULT '',assigned_classes TEXT NOT NULL DEFAULT '',joining_date TEXT NOT NULL,salary DOUBLE PRECISION NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'Active',created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(institution_id,employee_id));
CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),name TEXT NOT NULL,section TEXT NOT NULL,teacher TEXT NOT NULL DEFAULT '',academic_year TEXT NOT NULL,capacity INTEGER NOT NULL DEFAULT 40,status TEXT NOT NULL DEFAULT 'Active',created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(institution_id,name,section,academic_year));
CREATE TABLE IF NOT EXISTS attendance(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,date TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('Present','Absent','Late','Leave')),remarks TEXT NOT NULL DEFAULT '',marked_by TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(student_id,date));
CREATE TABLE IF NOT EXISTS fees(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,invoice_number TEXT NOT NULL UNIQUE,fee_type TEXT NOT NULL DEFAULT 'Annual Fee',academic_year TEXT NOT NULL,total_amount DOUBLE PRECISION NOT NULL CHECK(total_amount>=0),discount DOUBLE PRECISION NOT NULL DEFAULT 0,final_amount DOUBLE PRECISION NOT NULL CHECK(final_amount>=0),paid_amount DOUBLE PRECISION NOT NULL DEFAULT 0,pending_amount DOUBLE PRECISION NOT NULL CHECK(pending_amount>=0),due_date TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),student_id TEXT NOT NULL REFERENCES students(id),fee_id TEXT NOT NULL REFERENCES fees(id),receipt_number TEXT NOT NULL UNIQUE,amount DOUBLE PRECISION NOT NULL CHECK(amount>0),payment_method TEXT NOT NULL,transaction_id TEXT NOT NULL DEFAULT '',payment_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Success',notes TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),receipt_number TEXT NOT NULL UNIQUE,student_id TEXT NOT NULL REFERENCES students(id),payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),invoice_number TEXT NOT NULL,amount DOUBLE PRECISION NOT NULL,payment_method TEXT NOT NULL,transaction_id TEXT NOT NULL DEFAULT '',issued_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Issued',created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),type TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,student_id TEXT,payment_id TEXT,amount DOUBLE PRECISION,timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL DEFAULT 'Success');
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),user_id TEXT,type TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(institution_id TEXT PRIMARY KEY REFERENCES institutions(id),academic_year TEXT NOT NULL DEFAULT '2026-2027',school_address TEXT NOT NULL DEFAULT '',school_phone TEXT NOT NULL DEFAULT '',school_email TEXT NOT NULL DEFAULT '',logo_url TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS counters(institution_id TEXT NOT NULL,kind TEXT NOT NULL,year TEXT NOT NULL,value INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(institution_id,kind,year));
CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),user_id TEXT,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscription_plans(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,student_limit INTEGER NOT NULL,price DOUBLE PRECISION NOT NULL,billing_period TEXT NOT NULL DEFAULT 'year',active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),plan_id TEXT NOT NULL REFERENCES subscription_plans(id),student_capacity INTEGER NOT NULL,amount_paid DOUBLE PRECISION NOT NULL DEFAULT 0,status TEXT NOT NULL,activation_date TIMESTAMPTZ,expiry_date TIMESTAMPTZ,razorpay_order_id TEXT NOT NULL UNIQUE,razorpay_payment_id TEXT UNIQUE,razorpay_signature TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscription_payments(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),plan TEXT NOT NULL,student_capacity INTEGER NOT NULL,amount DOUBLE PRECISION NOT NULL,razorpay_payment_id TEXT NOT NULL UNIQUE,payment_date TEXT NOT NULL,starts_at TIMESTAMPTZ NOT NULL,ends_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS razorpay_webhook_events(id TEXT PRIMARY KEY,event_type TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_students_institution ON students(institution_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_module_records ON module_records(institution_id,module);
CREATE INDEX IF NOT EXISTS idx_attendance_scope ON attendance(institution_id,date,status);
CREATE INDEX IF NOT EXISTS idx_fees_scope ON fees(institution_id,status,due_date);
CREATE INDEX IF NOT EXISTS idx_payments_scope ON payments(institution_id,payment_date,created_at);
`);
    for (const p of SUBSCRIPTION_PLANS)
      await run(
        "INSERT INTO subscription_plans(id,name,student_limit,price,billing_period,active)VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,student_limit=EXCLUDED.student_limit,price=EXCLUDED.price,billing_period=EXCLUDED.billing_period,active=EXCLUDED.active,updated_at=CURRENT_TIMESTAMP",
        [p.id, p.name, p.studentLimit, p.price, p.billingPeriod, p.active],
        sql,
      );
  })().catch((error) => {
    initializing = undefined;
    throw error;
  });
  return initializing;
}
async function ready() {
  await initialize();
  return connection();
}
export async function databaseHealth() {
  await row<{ ok: number }>("SELECT 1 AS ok", [], await ready());
}
async function audit(
  institutionId: string,
  userId: string | undefined,
  action: string,
  entity: string,
  entityId?: string,
  details: Record<string, unknown> = {},
  sql?: Sql,
) {
  await run(
    "INSERT INTO audit_logs(id,institution_id,user_id,action,entity,entity_id,details)VALUES(?,?,?,?,?,?,?::jsonb)",
    [
      randomUUID(),
      institutionId,
      userId ?? null,
      action,
      entity,
      entityId ?? null,
      JSON.stringify(details),
    ],
    sql ?? (await ready()),
  );
}
async function activity(
  institutionId: string,
  type: string,
  title: string,
  description: string,
  studentId?: string,
  paymentId?: string,
  amount?: number,
  sql?: Sql,
) {
  await run(
    "INSERT INTO activities(id,institution_id,type,title,description,student_id,payment_id,amount)VALUES(?,?,?,?,?,?,?,?)",
    [
      randomUUID(),
      institutionId,
      type,
      title,
      description,
      studentId ?? null,
      paymentId ?? null,
      amount ?? null,
    ],
    sql ?? (await ready()),
  );
}
async function notify(
  institutionId: string,
  userId: string | undefined,
  type: string,
  title: string,
  description: string,
  sql?: Sql,
) {
  await run(
    "INSERT INTO notifications(id,institution_id,user_id,type,title,description)VALUES(?,?,?,?,?,?)",
    [randomUUID(), institutionId, userId ?? null, type, title, description],
    sql ?? (await ready()),
  );
}
async function nextNumber(
  institutionId: string,
  kind: "REC" | "INV",
  date = new Date(),
  sql?: Sql,
) {
  const db = sql ?? (await ready()),
    year = String(date.getFullYear()),
    result = await row<{ value: number }>(
      "INSERT INTO counters(institution_id,kind,year,value)VALUES(?,?,?,1) ON CONFLICT(institution_id,kind,year) DO UPDATE SET value=counters.value+1 RETURNING value",
      [institutionId, kind, year],
      db,
    );
  return `${kind}-${year}-${String(result.value).padStart(6, "0")}`;
}

export async function getInstitution(institutionId: string) {
  return await row<{
    id: string;
    name: string;
    address: string;
    phone: string;
    email: string;
    logoUrl: string;
    academicYear: string;
  }>(
    "SELECT i.id,i.name,COALESCE(s.school_address,'') address,COALESCE(s.school_phone,'') phone,COALESCE(s.school_email,'') email,COALESCE(s.logo_url,'') AS \"logoUrl\",COALESCE(s.academic_year,'2026-2027') AS \"academicYear\" FROM institutions i LEFT JOIN settings s ON s.institution_id=i.id WHERE i.id=?",
    [institutionId],
    await ready(),
  );
}
export async function findUserByEmail(email: string) {
  return await row<DbUser & { passwordHash: string }>(
    'SELECT id,email,name,password_hash AS "passwordHash",role,institution_id AS "institutionId" FROM users WHERE email=?',
    [email.toLowerCase()],
    await ready(),
  );
}
export async function createAccount(input: {
  name: string;
  email: string;
  institution: string;
  passwordHash: string;
}) {
  await ready();
  const institutionId = randomUUID(),
    id = randomUUID(),
    email = input.email.toLowerCase();
  await connection().begin(async (tx) => {
    await run(
      "INSERT INTO institutions(id,name)VALUES(?,?)",
      [institutionId, input.institution],
      tx,
    );
    await run(
      "INSERT INTO users(id,email,name,password_hash,role,institution_id)VALUES(?,?,?,?,?,?)",
      [
        id,
        email,
        input.name,
        input.passwordHash,
        "SCHOOL_ADMIN",
        institutionId,
      ],
      tx,
    );
    await run(
      "INSERT INTO settings(institution_id,school_email)VALUES(?,?)",
      [institutionId, email],
      tx,
    );
  });
  return {
    id,
    email,
    name: input.name,
    role: "SCHOOL_ADMIN",
    institutionId,
  } as DbUser;
}
export async function createSession(userId: string) {
  const db = await ready(),
    token = randomUUID() + randomUUID().replaceAll("-", ""),
    expires = new Date(Date.now() + 7 * 864e5);
  await run("DELETE FROM sessions WHERE expires_at<CURRENT_TIMESTAMP", [], db);
  await run(
    "INSERT INTO sessions(token,user_id,expires_at)VALUES(?,?,?)",
    [token, userId, expires],
    db,
  );
  return { token, expires };
}
export async function getUserBySession(token: string) {
  return await row<DbUser>(
    'SELECT u.id,u.email,u.name,u.role,u.institution_id AS "institutionId" FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>CURRENT_TIMESTAMP',
    [token],
    await ready(),
  );
}
export async function deleteSession(token: string) {
  await run("DELETE FROM sessions WHERE token=?", [token], await ready());
}

const studentSelect = `SELECT s.id,s.name,s.admission,s.gender,s.date_of_birth AS "dateOfBirth",s.class_name AS "className",s.section,s.grade,s.roll_number AS "rollNumber",s.parent,s.parent_phone AS "parentPhone",s.parent_email AS "parentEmail",s.address,s.admission_date AS "admissionDate",s.attendance,s.fee,s.total_fee AS "totalFee",s.paid_fee AS "paidFee",s.pending_fee AS "pendingFee",s.status,s.created_at::text AS "createdAt" FROM students s`;
async function refreshFees(institutionId: string, sql?: Sql) {
  const db = sql ?? (await ready()),
    today = new Date().toISOString().slice(0, 10);
  await run(
    "UPDATE fees SET status=CASE WHEN pending_amount=0 THEN 'Paid' WHEN due_date<? THEN 'Overdue' WHEN paid_amount>0 THEN 'Partially Paid' ELSE 'Pending' END WHERE institution_id=?",
    [today, institutionId],
    db,
  );
  await run(
    "UPDATE students SET fee=CASE WHEN EXISTS(SELECT 1 FROM fees WHERE student_id=students.id AND status='Overdue') THEN 'Overdue' WHEN pending_fee=0 THEN 'Paid' WHEN paid_fee>0 THEN 'Partially Paid' ELSE 'Pending' END WHERE institution_id=?",
    [institutionId],
    db,
  );
}
export async function listStudents(
  institutionId: string,
  filters: {
    search?: string;
    className?: string;
    section?: string;
    fee?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const db = await ready();
  await refreshFees(institutionId, db);
  const where = ["s.institution_id=?"],
    args: unknown[] = [institutionId];
  if (filters.search) {
    where.push(
      "(s.name ILIKE ? OR s.admission ILIKE ? OR s.parent_phone ILIKE ?)",
    );
    const q = `%${filters.search}%`;
    args.push(q, q, q);
  }
  for (const [k, col] of [
    ["className", "s.class_name"],
    ["section", "s.section"],
    ["fee", "s.fee"],
  ] as const)
    if (filters[k]) {
      where.push(`${col}=?`);
      args.push(filters[k]);
    }
  let query = `${studentSelect} WHERE ${where.join(" AND ")} ORDER BY s.created_at DESC`;
  if (filters.limit) {
    query += " LIMIT ? OFFSET ?";
    args.push(filters.limit, filters.offset ?? 0);
  }
  return await rows<DbStudent>(query, args, db);
}
export async function getStudent(institutionId: string, id: string) {
  return await row<DbStudent>(
    `${studentSelect} WHERE s.institution_id=? AND s.id=?`,
    [institutionId, id],
    await ready(),
  );
}
export async function findStudentByAdmission(
  institutionId: string,
  admission: string,
) {
  return await row<DbStudent>(
    `${studentSelect} WHERE s.institution_id=? AND s.admission=?`,
    [institutionId, admission],
    await ready(),
  );
}
export async function addStudent(
  institutionId: string,
  input: StudentInput,
  userId?: string,
) {
  await ready();
  const id = randomUUID(),
    today = new Date(),
    admission =
      input.admission ||
      `EDL-${today.getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`,
    pending = Math.max(input.totalFee, 0);
  await connection().begin(async (tx) => {
    await run(
      "INSERT INTO students(id,institution_id,name,admission,gender,date_of_birth,class_name,section,grade,roll_number,parent,parent_phone,parent_email,address,admission_date,total_fee,paid_fee,pending_fee,attendance,fee,status)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        institutionId,
        input.name,
        admission,
        input.gender,
        input.dateOfBirth,
        input.className,
        input.section,
        `${input.className}${input.section ? `-${input.section}` : ""}`,
        input.rollNumber,
        input.parent,
        input.parentPhone,
        input.parentEmail,
        input.address,
        input.admissionDate,
        input.totalFee,
        0,
        pending,
        100,
        pending ? "Pending" : "Paid",
        "Active",
      ],
      tx,
    );
    if (input.totalFee > 0) {
      const invoice = await nextNumber(institutionId, "INV", today, tx);
      await run(
        "INSERT INTO fees(id,institution_id,student_id,invoice_number,academic_year,total_amount,final_amount,pending_amount,due_date,status)VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
          randomUUID(),
          institutionId,
          id,
          invoice,
          input.academicYear,
          input.totalFee,
          input.totalFee,
          input.totalFee,
          input.dueDate,
          "Pending",
        ],
        tx,
      );
    }
    await audit(
      institutionId,
      userId,
      "Student Added",
      "Student",
      id,
      { name: input.name, admission },
      tx,
    );
    await activity(
      institutionId,
      "student",
      "New student added",
      `${input.name} (${admission}) was enrolled`,
      id,
      undefined,
      undefined,
      tx,
    );
    await notify(
      institutionId,
      userId,
      "student",
      "New student added",
      `${input.name} was enrolled successfully.`,
      tx,
    );
  });
  return (await getStudent(institutionId, id))!;
}
export async function updateStudent(
  institutionId: string,
  id: string,
  input: Partial<StudentInput>,
  userId?: string,
) {
  const old = await getStudent(institutionId, id);
  if (!old) throw new Error("Student not found");
  const value = { ...old, ...input },
    db = await ready();
  await run(
    "UPDATE students SET name=?,admission=?,gender=?,date_of_birth=?,class_name=?,section=?,grade=?,roll_number=?,parent=?,parent_phone=?,parent_email=?,address=?,admission_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND institution_id=?",
    [
      value.name,
      value.admission,
      value.gender,
      value.dateOfBirth,
      value.className,
      value.section,
      `${value.className}${value.section ? `-${value.section}` : ""}`,
      value.rollNumber,
      value.parent,
      value.parentPhone,
      value.parentEmail,
      value.address,
      value.admissionDate,
      id,
      institutionId,
    ],
    db,
  );
  await audit(
    institutionId,
    userId,
    "Student Updated",
    "Student",
    id,
    { name: value.name },
    db,
  );
  return (await getStudent(institutionId, id))!;
}
export async function deleteStudent(
  institutionId: string,
  id: string,
  userId?: string,
) {
  const student = await getStudent(institutionId, id);
  if (!student) return false;
  const db = await ready(),
    payments = await row<{ count: number }>(
      "SELECT COUNT(*)::int count FROM payments WHERE student_id=?",
      [id],
      db,
    );
  if (payments.count)
    throw new Error(
      "Students with payment history cannot be deleted. Set them inactive instead.",
    );
  await run(
    "DELETE FROM students WHERE id=? AND institution_id=?",
    [id, institutionId],
    db,
  );
  await audit(
    institutionId,
    userId,
    "Student Deleted",
    "Student",
    id,
    { name: student.name },
    db,
  );
  return true;
}

export async function listTeachers(institutionId: string, search = "") {
  const q = `%${search}%`;
  return await rows<DbTeacher>(
    'SELECT id,name,employee_id AS "employeeId",email,phone,department,subject,assigned_classes AS classes,joining_date AS "joiningDate",salary,status,created_at::text AS "createdAt" FROM teachers WHERE institution_id=? AND (name ILIKE ? OR employee_id ILIKE ? OR subject ILIKE ?) ORDER BY created_at DESC',
    [institutionId, q, q, q],
    await ready(),
  );
}
export async function saveTeacher(
  institutionId: string,
  input: Omit<DbTeacher, "id" | "createdAt">,
  userId?: string,
) {
  const db = await ready(),
    id = randomUUID();
  await run(
    "INSERT INTO teachers(id,institution_id,name,employee_id,email,phone,department,subject,assigned_classes,joining_date,salary,status)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      institutionId,
      input.name,
      input.employeeId,
      input.email,
      input.phone,
      input.department,
      input.subject,
      input.classes,
      input.joiningDate,
      input.salary,
      input.status,
    ],
    db,
  );
  await audit(
    institutionId,
    userId,
    "Teacher Added",
    "Teacher",
    id,
    { name: input.name },
    db,
  );
  await activity(
    institutionId,
    "teacher",
    "New teacher added",
    `${input.name} joined ${input.department}`,
    undefined,
    undefined,
    undefined,
    db,
  );
  return (await listTeachers(institutionId)).find((x) => x.id === id)!;
}
export async function updateTeacher(
  institutionId: string,
  id: string,
  input: Omit<DbTeacher, "id" | "createdAt">,
  userId?: string,
) {
  const db = await ready();
  await run(
    "UPDATE teachers SET name=?,employee_id=?,email=?,phone=?,department=?,subject=?,assigned_classes=?,joining_date=?,salary=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND institution_id=?",
    [
      input.name,
      input.employeeId,
      input.email,
      input.phone,
      input.department,
      input.subject,
      input.classes,
      input.joiningDate,
      input.salary,
      input.status,
      id,
      institutionId,
    ],
    db,
  );
  await audit(
    institutionId,
    userId,
    "Teacher Updated",
    "Teacher",
    id,
    { name: input.name },
    db,
  );
  return (await listTeachers(institutionId)).find((x) => x.id === id);
}
export async function deleteTeacher(
  institutionId: string,
  id: string,
  userId?: string,
) {
  const db = await ready(),
    count = await run(
      "DELETE FROM teachers WHERE id=? AND institution_id=?",
      [id, institutionId],
      db,
    );
  if (count)
    await audit(
      institutionId,
      userId,
      "Teacher Deleted",
      "Teacher",
      id,
      {},
      db,
    );
  return count > 0;
}
export async function listClasses(
  institutionId: string,
  academicYear?: string,
) {
  const year =
    academicYear ?? (await getInstitution(institutionId)).academicYear;
  return await rows<DbClass>(
    'SELECT c.id,c.name,c.section,c.teacher,c.academic_year AS "academicYear",c.capacity,c.status,COUNT(s.id)::int AS "currentStudents" FROM classes c LEFT JOIN students s ON s.institution_id=c.institution_id AND s.class_name=c.name AND s.section=c.section WHERE c.institution_id=? AND c.academic_year=? GROUP BY c.id ORDER BY c.name,c.section',
    [institutionId, year],
    await ready(),
  );
}
export async function saveClass(
  institutionId: string,
  input: Omit<DbClass, "id" | "currentStudents">,
  userId?: string,
) {
  const db = await ready(),
    id = randomUUID();
  await run(
    "INSERT INTO classes(id,institution_id,name,section,teacher,academic_year,capacity,status)VALUES(?,?,?,?,?,?,?,?)",
    [
      id,
      institutionId,
      input.name,
      input.section,
      input.teacher,
      input.academicYear,
      input.capacity,
      input.status,
    ],
    db,
  );
  await audit(institutionId, userId, "Class Added", "Class", id, input, db);
  return (await listClasses(institutionId, input.academicYear)).find(
    (x) => x.id === id,
  )!;
}

export async function attendanceRoster(
  institutionId: string,
  date: string,
  className: string,
  section: string,
) {
  return await rows<{
    studentId: string;
    name: string;
    admission: string;
    className: string;
    section: string;
    status: string;
    remarks: string;
  }>(
    "SELECT s.id AS \"studentId\",s.name,s.admission,s.class_name AS \"className\",s.section,COALESCE(a.status,'Present') status,COALESCE(a.remarks,'') remarks FROM students s LEFT JOIN attendance a ON a.student_id=s.id AND a.date=? WHERE s.institution_id=? AND s.class_name=? AND s.section=? AND s.status='Active' ORDER BY s.name",
    [date, institutionId, className, section],
    await ready(),
  );
}
export async function listAttendance(
  institutionId: string,
  filters: {
    date?: string;
    className?: string;
    section?: string;
    status?: string;
  } = {},
) {
  const where = ["a.institution_id=?"],
    args: unknown[] = [institutionId];
  for (const [k, col] of [
    ["date", "a.date"],
    ["className", "s.class_name"],
    ["section", "s.section"],
    ["status", "a.status"],
  ] as const)
    if (filters[k]) {
      where.push(`${col}=?`);
      args.push(filters[k]);
    }
  return await rows(
    `SELECT a.id,a.date,s.name AS "studentName",s.admission,s.class_name AS "className",s.section,a.status,a.remarks,a.marked_by AS "markedBy" FROM attendance a JOIN students s ON s.id=a.student_id WHERE ${where.join(" AND ")} ORDER BY a.date DESC,s.name`,
    args,
    await ready(),
  );
}
export async function markAttendance(
  institutionId: string,
  date: string,
  records: { studentId: string; status: string; remarks?: string }[],
  markedBy: string,
  userId?: string,
) {
  await ready();
  await connection().begin(async (tx) => {
    const allowed = new Set(
      (
        await rows<{ id: string }>(
          "SELECT id FROM students WHERE institution_id=?",
          [institutionId],
          tx,
        )
      ).map((x) => x.id),
    );
    for (const item of records) {
      if (!allowed.has(item.studentId)) throw new Error("Invalid student");
      await run(
        "INSERT INTO attendance(id,institution_id,student_id,date,status,remarks,marked_by)VALUES(?,?,?,?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET status=EXCLUDED.status,remarks=EXCLUDED.remarks,marked_by=EXCLUDED.marked_by,updated_at=CURRENT_TIMESTAMP",
        [
          randomUUID(),
          institutionId,
          item.studentId,
          date,
          item.status,
          item.remarks ?? "",
          markedBy,
        ],
        tx,
      );
    }
    await run(
      "UPDATE students SET attendance=COALESCE((SELECT ROUND(100.0*SUM(CASE WHEN status IN ('Present','Late') THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0)) FROM attendance WHERE student_id=students.id),100),updated_at=CURRENT_TIMESTAMP WHERE institution_id=?",
      [institutionId],
      tx,
    );
    await audit(
      institutionId,
      userId,
      "Attendance Updated",
      "Attendance",
      date,
      { count: records.length },
      tx,
    );
    await activity(
      institutionId,
      "attendance",
      "Attendance updated",
      `${records.length} records marked for ${date}`,
      undefined,
      undefined,
      undefined,
      tx,
    );
  });
}

export async function listFees(
  institutionId: string,
  filters: {
    search?: string;
    className?: string;
    section?: string;
    status?: string;
  } = {},
) {
  const db = await ready();
  await refreshFees(institutionId, db);
  const where = ["f.institution_id=?"],
    args: unknown[] = [institutionId];
  if (filters.search) {
    where.push(
      "(s.name ILIKE ? OR s.admission ILIKE ? OR f.invoice_number ILIKE ?)",
    );
    const q = `%${filters.search}%`;
    args.push(q, q, q);
  }
  for (const [k, col] of [
    ["className", "s.class_name"],
    ["section", "s.section"],
    ["status", "f.status"],
  ] as const)
    if (filters[k]) {
      where.push(`${col}=?`);
      args.push(filters[k]);
    }
  return await rows<Record<string, string | number>>(
    `SELECT f.id,f.student_id AS "studentId",s.name AS "studentName",s.admission,s.class_name AS "className",s.section,f.invoice_number AS "invoiceNumber",f.fee_type AS "feeType",f.academic_year AS "academicYear",f.total_amount AS "totalAmount",f.discount,f.final_amount AS "finalAmount",f.paid_amount AS "paidAmount",f.pending_amount AS "pendingAmount",f.due_date AS "dueDate",f.status FROM fees f JOIN students s ON s.id=f.student_id WHERE ${where.join(" AND ")} ORDER BY f.due_date,f.created_at DESC`,
    args,
    db,
  );
}
export async function getFee(institutionId: string, id: string) {
  return await row<Record<string, string | number>>(
    'SELECT f.id,f.student_id AS "studentId",s.name AS "studentName",s.admission,s.class_name AS "className",s.section,s.parent,f.invoice_number AS "invoiceNumber",f.fee_type AS "feeType",f.academic_year AS "academicYear",f.total_amount AS "totalAmount",f.paid_amount AS "paidAmount",f.pending_amount AS "pendingAmount",f.due_date AS "dueDate",f.status FROM fees f JOIN students s ON s.id=f.student_id WHERE f.institution_id=? AND f.id=?',
    [institutionId, id],
    await ready(),
  );
}
export async function createFee(
  institutionId: string,
  studentId: string,
  input: {
    feeType: string;
    academicYear: string;
    totalAmount: number;
    dueDate: string;
  },
  userId?: string,
) {
  if (!(await getStudent(institutionId, studentId)))
    throw new Error("Student not found");
  const id = randomUUID();
  await connection().begin(async (tx) => {
    const invoice = await nextNumber(institutionId, "INV", new Date(), tx);
    await run(
      "INSERT INTO fees(id,institution_id,student_id,invoice_number,fee_type,academic_year,total_amount,final_amount,pending_amount,due_date,status)VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        institutionId,
        studentId,
        invoice,
        input.feeType,
        input.academicYear,
        input.totalAmount,
        input.totalAmount,
        input.totalAmount,
        input.dueDate,
        "Pending",
      ],
      tx,
    );
    await run(
      "UPDATE students SET total_fee=total_fee+?,pending_fee=pending_fee+?,fee='Pending',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [input.totalAmount, input.totalAmount, studentId],
      tx,
    );
    await audit(
      institutionId,
      userId,
      "Fee Created",
      "Fee",
      id,
      { invoice, totalAmount: input.totalAmount },
      tx,
    );
  });
  return id;
}

const paymentSelect = `SELECT p.id,p.fee_id AS "feeId",p.student_id AS "studentId",s.name AS "studentName",s.admission,s.class_name AS "className",s.section,f.invoice_number AS "invoiceNumber",p.receipt_number AS "receiptNumber",p.amount,p.payment_method AS method,p.transaction_id AS "transactionId",p.payment_date AS "paymentDate",p.status,p.notes,(SELECT COALESCE(SUM(p2.amount),0) FROM payments p2 WHERE p2.fee_id=p.fee_id AND (p2.created_at,p2.id)<(p.created_at,p.id)) AS "previouslyPaid",(SELECT COALESCE(SUM(p2.amount),0) FROM payments p2 WHERE p2.fee_id=p.fee_id AND (p2.created_at,p2.id)<=(p.created_at,p.id)) AS "totalPaid",(f.final_amount-(SELECT COALESCE(SUM(p2.amount),0) FROM payments p2 WHERE p2.fee_id=p.fee_id AND (p2.created_at,p2.id)<=(p.created_at,p.id))) AS "remainingBalance",p.created_at::text AS "createdAt" FROM payments p JOIN students s ON s.id=p.student_id JOIN fees f ON f.id=p.fee_id`;
export async function getPayment(institutionId: string, id: string) {
  return await row<DbPayment>(
    `${paymentSelect} WHERE p.institution_id=? AND p.id=?`,
    [institutionId, id],
    await ready(),
  );
}
export async function getReceipt(institutionId: string, receipt: string) {
  return await row<DbPayment>(
    `${paymentSelect} WHERE p.institution_id=? AND p.receipt_number=?`,
    [institutionId, receipt],
    await ready(),
  );
}
export async function listPayments(
  institutionId: string,
  filters: {
    search?: string;
    className?: string;
    section?: string;
    method?: string;
    status?: string;
    from?: string;
    to?: string;
    studentId?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const where = ["p.institution_id=?"],
    args: unknown[] = [institutionId];
  if (filters.search) {
    where.push(
      "(s.name ILIKE ? OR s.admission ILIKE ? OR p.receipt_number ILIKE ? OR f.invoice_number ILIKE ? OR p.transaction_id ILIKE ? OR s.parent_phone ILIKE ?)",
    );
    const q = `%${filters.search}%`;
    args.push(q, q, q, q, q, q);
  }
  for (const [k, col] of [
    ["className", "s.class_name"],
    ["section", "s.section"],
    ["method", "p.payment_method"],
    ["status", "p.status"],
    ["studentId", "p.student_id"],
  ] as const)
    if (filters[k]) {
      where.push(`${col}=?`);
      args.push(filters[k]);
    }
  if (filters.from) {
    where.push("p.payment_date>=?");
    args.push(filters.from);
  }
  if (filters.to) {
    where.push("p.payment_date<=?");
    args.push(filters.to);
  }
  let query = `${paymentSelect} WHERE ${where.join(" AND ")} ORDER BY p.payment_date DESC,p.created_at DESC`;
  if (filters.limit) {
    query += " LIMIT ? OFFSET ?";
    args.push(filters.limit, filters.offset ?? 0);
  }
  return await rows<DbPayment>(query, args, await ready());
}
export async function recordPayment(
  institutionId: string,
  userId: string,
  input: {
    feeId: string;
    amount: number;
    method: string;
    paymentDate: string;
    transactionId: string;
    notes: string;
  },
) {
  await ready();
  let id = "";
  await connection().begin(async (tx) => {
    const fee = await row<Record<string, string | number>>(
      'SELECT f.id,f.student_id AS "studentId",s.name AS "studentName",f.invoice_number AS "invoiceNumber",f.total_amount AS "totalAmount",f.paid_amount AS "paidAmount",f.pending_amount AS "pendingAmount" FROM fees f JOIN students s ON s.id=f.student_id WHERE f.institution_id=? AND f.id=? FOR UPDATE',
      [institutionId, input.feeId],
      tx,
    );
    if (!fee) throw new Error("Fee invoice not found");
    if (input.amount <= 0)
      throw new Error("Payment amount must be greater than zero");
    if (input.amount > Number(fee.pendingAmount))
      throw new Error("Payment cannot exceed the remaining amount");
    const receipt = await nextNumber(
        institutionId,
        "REC",
        new Date(input.paymentDate),
        tx,
      ),
      total = Number(fee.paidAmount) + input.amount,
      remaining = Math.max(Number(fee.totalAmount) - total, 0),
      status = remaining ? "Partially Paid" : "Paid";
    id = randomUUID();
    await run(
      "INSERT INTO payments(id,institution_id,student_id,fee_id,receipt_number,amount,payment_method,transaction_id,payment_date,status,notes,created_by)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        id,
        institutionId,
        fee.studentId,
        input.feeId,
        receipt,
        input.amount,
        input.method,
        input.transactionId,
        input.paymentDate,
        "Success",
        input.notes,
        userId,
      ],
      tx,
    );
    await run(
      "UPDATE fees SET paid_amount=?,pending_amount=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [total, remaining, status, input.feeId],
      tx,
    );
    await run(
      "UPDATE students SET paid_fee=(SELECT COALESCE(SUM(paid_amount),0) FROM fees WHERE student_id=?),pending_fee=(SELECT COALESCE(SUM(pending_amount),0) FROM fees WHERE student_id=?),total_fee=(SELECT COALESCE(SUM(final_amount),0) FROM fees WHERE student_id=?),fee=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [fee.studentId, fee.studentId, fee.studentId, status, fee.studentId],
      tx,
    );
    await run(
      "INSERT INTO receipts(id,institution_id,receipt_number,student_id,payment_id,invoice_number,amount,payment_method,transaction_id,issued_date)VALUES(?,?,?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        institutionId,
        receipt,
        fee.studentId,
        id,
        fee.invoiceNumber,
        input.amount,
        input.method,
        input.transactionId,
        input.paymentDate,
      ],
      tx,
    );
    await activity(
      institutionId,
      "payment",
      "Fee payment received",
      `${fee.studentName} paid ₹${input.amount.toLocaleString("en-IN")}`,
      String(fee.studentId),
      id,
      input.amount,
      tx,
    );
    await audit(
      institutionId,
      userId,
      "Payment Created",
      "Payment",
      id,
      { amount: input.amount, receipt },
      tx,
    );
    await notify(
      institutionId,
      userId,
      "payment",
      "New payment received",
      `${fee.studentName} paid ₹${input.amount.toLocaleString("en-IN")}.`,
      tx,
    );
  });
  return (await getPayment(institutionId, id))!;
}

export async function listActivities(institutionId: string, limit = 25) {
  return await rows(
    'SELECT id,type,title,description,student_id AS "studentId",payment_id AS "paymentId",amount,timestamp::text,status FROM activities WHERE institution_id=? ORDER BY timestamp DESC LIMIT ?',
    [institutionId, limit],
    await ready(),
  );
}
export async function dashboardData(institutionId: string) {
  const db = await ready();
  await refreshFees(institutionId, db);
  const today = new Date().toISOString().slice(0, 10),
    month = today.slice(0, 7);
  const [
    students,
    teachers,
    attendance,
    fees,
    collections,
    monthly,
    methods,
    recentPayments,
    activities,
  ] = await Promise.all([
    row<{ count: number }>(
      "SELECT COUNT(*)::int count FROM students WHERE institution_id=? AND status='Active'",
      [institutionId],
      db,
    ),
    row<{ count: number }>(
      "SELECT COUNT(*)::int count FROM teachers WHERE institution_id=? AND status='Active'",
      [institutionId],
      db,
    ),
    row<{ present: number | null; absent: number | null }>(
      "SELECT SUM(CASE WHEN status IN ('Present','Late') THEN 1 ELSE 0 END)::int present,SUM(CASE WHEN status='Absent' THEN 1 ELSE 0 END)::int absent FROM attendance WHERE institution_id=? AND date=?",
      [institutionId, today],
      db,
    ),
    row<{ total: number; collected: number; pending: number; overdue: number }>(
      "SELECT COALESCE(SUM(final_amount),0) total,COALESCE(SUM(paid_amount),0) collected,COALESCE(SUM(pending_amount),0) pending,COALESCE(SUM(CASE WHEN due_date<? AND pending_amount>0 THEN pending_amount ELSE 0 END),0) overdue FROM fees WHERE institution_id=?",
      [today, institutionId],
      db,
    ),
    row<{ today: number; month: number; transactions: number }>(
      "SELECT COALESCE(SUM(CASE WHEN payment_date=? THEN amount ELSE 0 END),0) today,COALESCE(SUM(CASE WHEN SUBSTRING(payment_date,1,7)=? THEN amount ELSE 0 END),0) month,COUNT(*)::int transactions FROM payments WHERE institution_id=? AND status='Success'",
      [today, month, institutionId],
      db,
    ),
    rows<{ month: string; amount: number }>(
      "SELECT SUBSTRING(payment_date,1,7) month,SUM(amount) amount FROM payments WHERE institution_id=? AND status='Success' GROUP BY SUBSTRING(payment_date,1,7) ORDER BY month DESC LIMIT 12",
      [institutionId],
      db,
    ),
    rows(
      "SELECT payment_method method,SUM(amount) amount FROM payments WHERE institution_id=? AND status='Success' GROUP BY payment_method ORDER BY amount DESC",
      [institutionId],
      db,
    ),
    listPayments(institutionId, { limit: 5 }),
    listActivities(institutionId, 6),
  ]);
  return {
    students: students.count,
    teachers: teachers.count,
    present: attendance?.present ?? 0,
    absent: attendance?.absent ?? 0,
    fees: fees ?? { total: 0, collected: 0, pending: 0, overdue: 0 },
    collections: collections ?? { today: 0, month: 0, transactions: 0 },
    monthly: monthly.reverse(),
    methods,
    recentPayments,
    activities,
  };
}
export async function listNotifications(institutionId: string, userId: string) {
  return await rows(
    'SELECT id,type,title,description,read_at::text AS "readAt",created_at::text AS "createdAt" FROM notifications WHERE institution_id=? AND (user_id IS NULL OR user_id=?) ORDER BY created_at DESC LIMIT 25',
    [institutionId, userId],
    await ready(),
  );
}
export async function markNotificationsRead(
  institutionId: string,
  userId: string,
) {
  await run(
    "UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE institution_id=? AND (user_id IS NULL OR user_id=?) AND read_at IS NULL",
    [institutionId, userId],
    await ready(),
  );
}
export async function updateSettings(
  institutionId: string,
  input: {
    academicYear: string;
    address: string;
    phone: string;
    email: string;
  },
  userId: string,
) {
  const db = await ready();
  await run(
    "INSERT INTO settings(institution_id,academic_year,school_address,school_phone,school_email)VALUES(?,?,?,?,?) ON CONFLICT(institution_id) DO UPDATE SET academic_year=EXCLUDED.academic_year,school_address=EXCLUDED.school_address,school_phone=EXCLUDED.school_phone,school_email=EXCLUDED.school_email,updated_at=CURRENT_TIMESTAMP",
    [
      institutionId,
      input.academicYear,
      input.address,
      input.phone,
      input.email,
    ],
    db,
  );
  await audit(
    institutionId,
    userId,
    "Settings Updated",
    "Settings",
    institutionId,
    input,
    db,
  );
  return await getInstitution(institutionId);
}
export async function listAuditLogs(institutionId: string, limit = 100) {
  return await rows(
    'SELECT a.id,a.action,a.entity,a.entity_id AS "entityId",a.details,a.created_at::text AS "createdAt",u.name AS "userName" FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.institution_id=? ORDER BY a.created_at DESC LIMIT ?',
    [institutionId, limit],
    await ready(),
  );
}
export async function logExport(
  institutionId: string,
  userId: string,
  entity: string,
  count: number,
) {
  await audit(institutionId, userId, "Excel Exported", entity, undefined, {
    count,
  });
}
export async function logImport(
  institutionId: string,
  userId: string,
  entity: string,
  count: number,
) {
  const db = await ready();
  await audit(
    institutionId,
    userId,
    "Excel Imported",
    entity,
    undefined,
    { count },
    db,
  );
  await activity(
    institutionId,
    "import",
    "Import completed",
    `${count} ${entity.toLowerCase()} records imported`,
    undefined,
    undefined,
    undefined,
    db,
  );
  await notify(
    institutionId,
    userId,
    "import",
    "Import completed",
    `${count} ${entity.toLowerCase()} records imported successfully.`,
    db,
  );
}
export async function listModuleRecords(institutionId: string, module: string) {
  const data = await rows<{ id: string; data: Record<string, string> }>(
    "SELECT id,data FROM module_records WHERE institution_id=? AND module=? ORDER BY created_at DESC",
    [institutionId, module],
    await ready(),
  );
  return data.map((item) => ({ id: item.id, ...item.data }));
}
export async function addModuleRecord(
  institutionId: string,
  module: string,
  data: Record<string, string>,
) {
  const record = { id: randomUUID(), ...data };
  await run(
    "INSERT INTO module_records(id,institution_id,module,data)VALUES(?,?,?,?::jsonb)",
    [record.id, institutionId, module, JSON.stringify(data)],
    await ready(),
  );
  return record;
}

export async function listSubscriptionPayments(institutionId: string) {
  return await rows(
    'SELECT id,plan,student_capacity AS "studentCapacity",amount,razorpay_payment_id AS "razorpayPaymentId",payment_date AS "paymentDate",starts_at::text AS "startsAt",ends_at::text AS "endsAt",status FROM subscription_payments WHERE institution_id=? ORDER BY payment_date DESC',
    [institutionId],
    await ready(),
  );
}
export async function getSubscription(
  institutionId: string,
): Promise<SubscriptionSummary> {
  const db = await ready(),
    item = await row<Omit<SubscriptionSummary, "studentUsage">>(
      'SELECT s.status,s.plan_id AS "planId",p.name AS "planName",s.student_capacity AS "studentCapacity",s.amount_paid AS "amountPaid",s.activation_date::text AS "activationDate",s.expiry_date::text AS "expiryDate",s.razorpay_order_id AS "razorpayOrderId",s.razorpay_payment_id AS "razorpayPaymentId",s.razorpay_signature AS "razorpaySignature" FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.institution_id=? ORDER BY CASE WHEN s.status=\'ACTIVE\' AND s.expiry_date>CURRENT_TIMESTAMP THEN 0 ELSE 1 END,s.created_at DESC LIMIT 1',
      [institutionId],
      db,
    ),
    usage = (
      await row<{ count: number }>(
        "SELECT COUNT(*)::int count FROM students WHERE institution_id=? AND status='Active'",
        [institutionId],
        db,
      )
    ).count;
  if (!item)
    return {
      status: "UNPAID",
      planId: null,
      planName: null,
      studentCapacity: null,
      amountPaid: 0,
      activationDate: null,
      expiryDate: null,
      razorpayOrderId: null,
      razorpayPaymentId: null,
      razorpaySignature: null,
      studentUsage: usage,
    };
  const status = effectiveStatus(item.status, item.expiryDate ?? undefined);
  if (status !== item.status)
    await run(
      "UPDATE subscriptions SET status=?,updated_at=CURRENT_TIMESTAMP WHERE razorpay_order_id=?",
      [status, item.razorpayOrderId],
      db,
    );
  return { ...item, status, studentUsage: usage };
}
export async function hasActiveSubscription(institutionId: string) {
  return (await getSubscription(institutionId)).status === "ACTIVE";
}
export async function assertStudentCapacity(
  institutionId: string,
  additional = 1,
) {
  const item = await getSubscription(institutionId);
  if (item.status !== "ACTIVE" || !item.studentCapacity)
    throw new Error("SUBSCRIPTION_REQUIRED");
  if (item.studentUsage + additional > item.studentCapacity)
    throw new Error(
      `CAPACITY_EXCEEDED:${item.studentUsage}:${item.studentCapacity}:${additional}`,
    );
  return item;
}
export async function createPendingSubscription(
  institutionId: string,
  planId: string,
  orderId: string,
) {
  const plan = getPlan(planId);
  if (!plan) throw new Error("Invalid subscription plan");
  await run(
    "INSERT INTO subscriptions(id,institution_id,plan_id,student_capacity,amount_paid,status,razorpay_order_id)VALUES(?,?,?,?,?,'PENDING',?)",
    [
      randomUUID(),
      institutionId,
      plan.id,
      plan.studentLimit,
      plan.price,
      orderId,
    ],
    await ready(),
  );
  return await getSubscription(institutionId);
}
export async function failSubscription(
  orderId: string,
  status: "FAILED" | "CANCELLED" = "FAILED",
) {
  await run(
    "UPDATE subscriptions SET status=?,updated_at=CURRENT_TIMESTAMP WHERE razorpay_order_id=? AND status!='ACTIVE'",
    [status, orderId],
    await ready(),
  );
}
export async function findSubscriptionByOrder(orderId: string) {
  return await row<{
    id: string;
    institutionId: string;
    planId: string;
    amountPaid: number;
    status: string;
    paymentId: string | null;
  }>(
    'SELECT id,institution_id AS "institutionId",plan_id AS "planId",amount_paid AS "amountPaid",status,razorpay_payment_id AS "paymentId" FROM subscriptions WHERE razorpay_order_id=?',
    [orderId],
    await ready(),
  );
}
export async function recordWebhookEvent(id: string, type: string) {
  return (
    (await run(
      "INSERT INTO razorpay_webhook_events(id,event_type)VALUES(?,?) ON CONFLICT DO NOTHING",
      [id, type],
      await ready(),
    )) > 0
  );
}
export async function activateSubscription(
  orderId: string,
  paymentId: string,
  signature: string,
) {
  return await activateVerifiedSubscription(orderId, paymentId, signature);
}
export async function activateVerifiedSubscription(
  orderId: string,
  paymentId: string,
  signature: string,
) {
  await ready();
  let institutionId = "";
  await connection().begin(async (tx) => {
    const item = await row<{
      id: string;
      institutionId: string;
      planId: string;
      status: string;
      paymentId: string | null;
    }>(
      'SELECT id,institution_id AS "institutionId",plan_id AS "planId",status,razorpay_payment_id AS "paymentId" FROM subscriptions WHERE razorpay_order_id=? FOR UPDATE',
      [orderId],
      tx,
    );
    if (!item) throw new Error("Subscription order not found");
    institutionId = item.institutionId;
    if (item.status === "ACTIVE" && item.paymentId === paymentId) return;
    const prior = await row<{ expiryDate: string }>(
        "SELECT expiry_date::text AS \"expiryDate\" FROM subscriptions WHERE institution_id=? AND id!=? AND status='ACTIVE' AND expiry_date>CURRENT_TIMESTAMP ORDER BY expiry_date DESC LIMIT 1",
        [item.institutionId, item.id],
        tx,
      ),
      now = new Date(),
      start = prior ? new Date(prior.expiryDate) : now,
      expiry = addOneYear(start);
    await run(
      "UPDATE subscriptions SET status='ACTIVE',activation_date=?,expiry_date=?,razorpay_payment_id=?,razorpay_signature=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [now, expiry, paymentId, signature, item.id],
      tx,
    );
    await run(
      "INSERT INTO subscription_payments(id,institution_id,plan,student_capacity,amount,razorpay_payment_id,payment_date,starts_at,ends_at,status) SELECT ?,s.institution_id,p.name,s.student_capacity,s.amount_paid,?,?,?,?, 'ACTIVE' FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.id=? ON CONFLICT(razorpay_payment_id) DO NOTHING",
      [
        randomUUID(),
        paymentId,
        now.toISOString().slice(0, 10),
        start,
        expiry,
        item.id,
      ],
      tx,
    );
    await audit(
      item.institutionId,
      undefined,
      "Subscription Activated",
      "Subscription",
      item.id,
      { planId: item.planId, orderId, paymentId },
      tx,
    );
  });
  return await getSubscription(institutionId);
}
export async function listSubscriptions() {
  return await rows(
    'SELECT s.id,i.name school,p.name AS "planName",s.status,s.student_capacity AS "studentCapacity",s.amount_paid AS "amountPaid",s.activation_date::text AS "activationDate",s.expiry_date::text AS "expiryDate",s.razorpay_order_id AS "razorpayOrderId",s.razorpay_payment_id AS "razorpayPaymentId",(SELECT COUNT(*)::int FROM students st WHERE st.institution_id=s.institution_id AND st.status=\'Active\') AS "studentUsage" FROM subscriptions s JOIN institutions i ON i.id=s.institution_id JOIN subscription_plans p ON p.id=s.plan_id ORDER BY s.created_at DESC',
    [],
    await ready(),
  );
}

export async function deleteAllRecords(
  institutionId: string,
  type: string,
  userId: string,
) {
  await ready();
  let count = 0;
  await connection().begin(async (tx) => {
    if (type === "students") {
      count = (
        await row<{ count: number }>(
          "SELECT COUNT(*)::int count FROM students WHERE institution_id=?",
          [institutionId],
          tx,
        )
      ).count;
      for (const table of [
        "receipts",
        "payments",
        "fees",
        "attendance",
        "students",
      ])
        await run(
          `DELETE FROM ${table} WHERE institution_id=?`,
          [institutionId],
          tx,
        );
    } else if (type === "teachers" || type === "classes")
      count = await run(
        `DELETE FROM ${type} WHERE institution_id=?`,
        [institutionId],
        tx,
      );
    else if (type === "attendance") {
      count = await run(
        "DELETE FROM attendance WHERE institution_id=?",
        [institutionId],
        tx,
      );
      await run(
        "UPDATE students SET attendance=100,updated_at=CURRENT_TIMESTAMP WHERE institution_id=?",
        [institutionId],
        tx,
      );
    } else if (type === "fees" || type === "reports") {
      count = (
        await row<{ count: number }>(
          "SELECT COUNT(*)::int count FROM fees WHERE institution_id=?",
          [institutionId],
          tx,
        )
      ).count;
      for (const table of ["receipts", "payments", "fees"])
        await run(
          `DELETE FROM ${table} WHERE institution_id=?`,
          [institutionId],
          tx,
        );
      await run(
        "UPDATE students SET total_fee=0,paid_fee=0,pending_fee=0,fee='Paid',updated_at=CURRENT_TIMESTAMP WHERE institution_id=?",
        [institutionId],
        tx,
      );
    } else if (type === "payments") {
      count = (
        await row<{ count: number }>(
          "SELECT COUNT(*)::int count FROM payments WHERE institution_id=?",
          [institutionId],
          tx,
        )
      ).count;
      await run(
        "DELETE FROM receipts WHERE institution_id=?",
        [institutionId],
        tx,
      );
      await run(
        "DELETE FROM payments WHERE institution_id=?",
        [institutionId],
        tx,
      );
      await run(
        "UPDATE fees SET paid_amount=0,pending_amount=final_amount,status=CASE WHEN due_date<CURRENT_DATE::text THEN 'Overdue' ELSE 'Pending' END,updated_at=CURRENT_TIMESTAMP WHERE institution_id=?",
        [institutionId],
        tx,
      );
      await run(
        "UPDATE students SET paid_fee=0,pending_fee=total_fee,fee=CASE WHEN EXISTS(SELECT 1 FROM fees WHERE student_id=students.id AND status='Overdue') THEN 'Overdue' WHEN total_fee=0 THEN 'Paid' ELSE 'Pending' END,updated_at=CURRENT_TIMESTAMP WHERE institution_id=?",
        [institutionId],
        tx,
      );
    } else if (type === "assignments" || type === "messages")
      count = await run(
        "DELETE FROM module_records WHERE institution_id=? AND module=?",
        [institutionId, type],
        tx,
      );
    else throw new Error("Unsupported section");
    await audit(
      institutionId,
      userId,
      "All Records Deleted",
      type,
      undefined,
      { count },
      tx,
    );
    await activity(
      institutionId,
      "delete",
      `${type} cleared`,
      `${count} records were deleted`,
      undefined,
      undefined,
      undefined,
      tx,
    );
  });
  return count;
}
