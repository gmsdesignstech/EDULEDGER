import "server-only";
import postgres from "postgres";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SUBSCRIPTION_PLANS, getPlan } from "./subscription-plans";
import {
  addOneYear,
  effectiveStatus,
  getDaysRemaining,
  getSubscriptionStatus,
  isSubscriptionActive,
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
  academicYear: string;
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
  rollNumber: string;
  parent: string;
  invoiceNumber: string;
  feeType: string;
  academicYear: string;
  discount: number;
  finalAmount: number;
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
  daysRemaining: number;
  durationProgress: number;
  currency: string;
  paymentStatus: string;
  autoRenew: boolean;
};
export type ModuleRecord = { id: string; [key: string]: string };

type QueryResult = Record<string, unknown>[] & { count?: number };
type Sql = {
  dialect: "postgres" | "sqlite";
  unsafe(query: string, args?: unknown[]): Promise<QueryResult>;
  begin<T>(callback: (sql: Sql) => Promise<T>): Promise<T>;
};

let client: Sql | undefined, initializing: Promise<void> | undefined;

function sqliteQuery(query: string) {
  return query
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(/::(?:text|int|jsonb)\b/gi, "")
    .replace(/\s+FOR UPDATE\b/gi, "")
    .replace(/\bCURRENT_DATE\b/gi, "date('now')");
}

function sqliteConnection(): Sql {
  const path =
    process.env.SQLITE_DATABASE_PATH ||
    join(process.cwd(), "data", "eduledger.db");
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(
    "PRAGMA busy_timeout=30000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;",
  );

  const adapter: Sql = {
    dialect: "sqlite",
    async unsafe(query, args = []) {
      const sql = sqliteQuery(query);
      const normalizedArgs = args.map((value) => {
        if (value === undefined) return null;
        if (value instanceof Date) return value.toISOString();
        if (typeof value === "boolean") return Number(value);
        if (typeof value === "bigint") return Number(value);
        return value;
      });
      if (!args.length && sql.includes(";")) {
        database.exec(sql);
        return [] as QueryResult;
      }
      const statement = database.prepare(sql);
      if (
        /^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql) ||
        /\bRETURNING\b/i.test(sql)
      )
        return statement.all(...(normalizedArgs as never[])) as QueryResult;
      const result = statement.run(...(normalizedArgs as never[]));
      const rows = [] as QueryResult;
      rows.count = Number(result.changes);
      return rows;
    },
    async begin<T>(callback: (sql: Sql) => Promise<T>) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(adapter);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return adapter;
}

function connection() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production" && !process.env.SQLITE_DATABASE_PATH)
      throw new Error(
        "DATABASE_URL is not configured. Connect a PostgreSQL database in production.",
      );
    return (client ??= sqliteConnection());
  }
  if (client) return client;
  const sql = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
  const adapter: Sql = {
    dialect: "postgres",
    unsafe: (query, args = []) =>
      sql.unsafe(query, args as never[]) as unknown as Promise<QueryResult>,
    async begin<T>(callback: (sql: Sql) => Promise<T>) {
      const result = await sql.begin((transaction) => {
        const transactionAdapter: Sql = {
          dialect: "postgres",
          unsafe: (query, args = []) =>
            transaction.unsafe(query, args as never[]) as unknown as Promise<QueryResult>,
          begin: async () => {
            throw new Error("Nested database transactions are not supported");
          },
        };
        return callback(transactionAdapter);
      });
      return result as unknown as T;
    },
  };
  client = adapter;
  return adapter;
}
function bind(query: string, sql: Sql) {
  if (sql.dialect === "sqlite") return sqliteQuery(query);
  let n = 0;
  return query.replace(/\?/g, () => `$${++n}`);
}
async function rows<T extends Record<string, unknown>>(
  query: string,
  args: unknown[] = [],
  sql: Sql = connection(),
) {
  return (await sql.unsafe(bind(query, sql), args)) as unknown as T[];
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
  return Number((await sql.unsafe(bind(query, sql), args)).count ?? 0);
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
CREATE TABLE IF NOT EXISTS academic_years(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),name TEXT NOT NULL,start_month INTEGER NOT NULL DEFAULT 4 CHECK(start_month BETWEEN 1 AND 12),end_month INTEGER NOT NULL DEFAULT 3 CHECK(end_month BETWEEN 1 AND 12),status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Archived')),is_active BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(institution_id,name));
CREATE TABLE IF NOT EXISTS institution_classes(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),name TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(institution_id,name));
CREATE TABLE IF NOT EXISTS institution_sections(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),class_id TEXT NOT NULL REFERENCES institution_classes(id) ON DELETE RESTRICT,name TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive')),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(class_id,name));
CREATE TABLE IF NOT EXISTS school_assets(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),kind TEXT NOT NULL CHECK(kind IN ('logo','signature')),mime_type TEXT NOT NULL,data BYTEA NOT NULL,size_bytes INTEGER NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(institution_id,kind));
CREATE TABLE IF NOT EXISTS student_enrollments(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,academic_year TEXT NOT NULL,class_name TEXT NOT NULL,section TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Active',promoted_from_enrollment_id TEXT REFERENCES student_enrollments(id) ON DELETE SET NULL,promoted_at TIMESTAMPTZ,promoted_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(institution_id,student_id,academic_year));
CREATE TABLE IF NOT EXISTS promotion_batches(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),source_academic_year TEXT NOT NULL,target_academic_year TEXT NOT NULL,source_class TEXT NOT NULL,source_section TEXT NOT NULL DEFAULT '',target_class TEXT NOT NULL,target_section TEXT NOT NULL DEFAULT '',promoted_by TEXT NOT NULL REFERENCES users(id),promoted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL DEFAULT 'Completed',correction_reason TEXT);
CREATE TABLE IF NOT EXISTS promotion_items(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES promotion_batches(id) ON DELETE RESTRICT,institution_id TEXT NOT NULL REFERENCES institutions(id),student_id TEXT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,source_enrollment_id TEXT NOT NULL REFERENCES student_enrollments(id),target_enrollment_id TEXT NOT NULL REFERENCES student_enrollments(id),status TEXT NOT NULL DEFAULT 'Promoted',error_message TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(institution_id,student_id,target_enrollment_id));
CREATE TABLE IF NOT EXISTS counters(institution_id TEXT NOT NULL,kind TEXT NOT NULL,year TEXT NOT NULL,value INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(institution_id,kind,year));
CREATE TABLE IF NOT EXISTS audit_logs(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),user_id TEXT,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id TEXT,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscription_plans(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,student_limit INTEGER NOT NULL,price DOUBLE PRECISION NOT NULL,billing_period TEXT NOT NULL DEFAULT 'year',active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),plan_id TEXT NOT NULL REFERENCES subscription_plans(id),student_capacity INTEGER NOT NULL,amount_paid DOUBLE PRECISION NOT NULL DEFAULT 0,status TEXT NOT NULL,activation_date TIMESTAMPTZ,expiry_date TIMESTAMPTZ,razorpay_order_id TEXT NOT NULL UNIQUE,razorpay_payment_id TEXT UNIQUE,razorpay_signature TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscription_payments(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),plan TEXT NOT NULL,student_capacity INTEGER NOT NULL,amount DOUBLE PRECISION NOT NULL,razorpay_payment_id TEXT NOT NULL UNIQUE,payment_date TEXT NOT NULL,starts_at TIMESTAMPTZ NOT NULL,ends_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS razorpay_webhook_events(id TEXT PRIMARY KEY,event_type TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscription_notification_events(id TEXT PRIMARY KEY,subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,institution_id TEXT NOT NULL REFERENCES institutions(id),milestone TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'SENT',attempts INTEGER NOT NULL DEFAULT 1,last_error TEXT NOT NULL DEFAULT '',sent_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(subscription_id,milestone));
CREATE TABLE IF NOT EXISTS subscription_processing_logs(id TEXT PRIMARY KEY,started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,finished_at TIMESTAMPTZ,status TEXT NOT NULL,checked_count INTEGER NOT NULL DEFAULT 0,expired_count INTEGER NOT NULL DEFAULT 0,notification_count INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS timetable_entries(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),class_name TEXT NOT NULL,section TEXT NOT NULL,academic_year TEXT NOT NULL,subject TEXT NOT NULL,teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 6),start_time TEXT NOT NULL,end_time TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(institution_id,class_name,section,academic_year,weekday,start_time));
CREATE TABLE IF NOT EXISTS class_exams(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),class_name TEXT NOT NULL,section TEXT NOT NULL,academic_year TEXT NOT NULL,name TEXT NOT NULL,exam_date TEXT NOT NULL,subject TEXT NOT NULL,max_marks DOUBLE PRECISION NOT NULL,passing_marks DOUBLE PRECISION NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS class_results(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),exam_id TEXT NOT NULL REFERENCES class_exams(id) ON DELETE CASCADE,student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,marks DOUBLE PRECISION NOT NULL,grade TEXT NOT NULL,status TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(exam_id,student_id));
CREATE TABLE IF NOT EXISTS account_transactions(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),academic_year TEXT NOT NULL,transaction_type TEXT NOT NULL CHECK(transaction_type IN ('income','expense')),category TEXT NOT NULL,amount_paise INTEGER NOT NULL CHECK(amount_paise>0),transaction_date TEXT NOT NULL,description TEXT NOT NULL,payment_method TEXT NOT NULL,reference_number TEXT NOT NULL DEFAULT '',source_type TEXT NOT NULL DEFAULT 'cash_book',source_id TEXT,status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Voided')),notes TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS salaries(id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id),employee_key TEXT NOT NULL,teacher_id TEXT REFERENCES teachers(id) ON DELETE RESTRICT,user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,employee_name TEXT NOT NULL,employee_number TEXT NOT NULL,employee_role TEXT NOT NULL,department TEXT NOT NULL DEFAULT '',designation TEXT NOT NULL DEFAULT '',salary_month INTEGER NOT NULL CHECK(salary_month BETWEEN 1 AND 12),salary_year INTEGER NOT NULL CHECK(salary_year BETWEEN 2000 AND 2200),basic_paise INTEGER NOT NULL CHECK(basic_paise>=0),allowances_paise INTEGER NOT NULL DEFAULT 0 CHECK(allowances_paise>=0),bonus_paise INTEGER NOT NULL DEFAULT 0 CHECK(bonus_paise>=0),overtime_paise INTEGER NOT NULL DEFAULT 0 CHECK(overtime_paise>=0),other_earnings_paise INTEGER NOT NULL DEFAULT 0 CHECK(other_earnings_paise>=0),gross_paise INTEGER NOT NULL CHECK(gross_paise>=0),deductions_paise INTEGER NOT NULL DEFAULT 0 CHECK(deductions_paise>=0),advance_deduction_paise INTEGER NOT NULL DEFAULT 0 CHECK(advance_deduction_paise>=0),other_deductions_paise INTEGER NOT NULL DEFAULT 0 CHECK(other_deductions_paise>=0),total_deductions_paise INTEGER NOT NULL CHECK(total_deductions_paise>=0),net_paise INTEGER NOT NULL CHECK(net_paise>=0),paid_paise INTEGER NOT NULL DEFAULT 0 CHECK(paid_paise>=0),payment_status TEXT NOT NULL DEFAULT 'Pending' CHECK(payment_status IN ('Pending','Paid','Partially Paid','Cancelled','On Hold')),payment_date TEXT,payment_method TEXT,payment_reference TEXT NOT NULL DEFAULT '',payment_notes TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',payslip_number TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(employee_key,salary_month,salary_year));
CREATE INDEX IF NOT EXISTS idx_students_institution ON students(institution_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_super_admin ON users(role) WHERE role='SUPER_ADMIN';
CREATE INDEX IF NOT EXISTS idx_module_records ON module_records(institution_id,module);
CREATE INDEX IF NOT EXISTS idx_attendance_scope ON attendance(institution_id,date,status);
CREATE INDEX IF NOT EXISTS idx_fees_scope ON fees(institution_id,status,due_date);
CREATE INDEX IF NOT EXISTS idx_payments_scope ON payments(institution_id,payment_date,created_at);
CREATE INDEX IF NOT EXISTS idx_timetable_class ON timetable_entries(institution_id,class_name,academic_year);
CREATE INDEX IF NOT EXISTS idx_exams_class ON class_exams(institution_id,class_name,academic_year);
CREATE INDEX IF NOT EXISTS idx_accounts_scope ON account_transactions(institution_id,academic_year,transaction_date,status);
CREATE INDEX IF NOT EXISTS idx_salaries_scope ON salaries(institution_id,salary_year,salary_month,payment_status);
CREATE INDEX IF NOT EXISTS idx_salaries_employee ON salaries(employee_key,created_at);
CREATE INDEX IF NOT EXISTS idx_salaries_payment_date ON salaries(payment_date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(status,expiry_date);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id,read_at,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_source ON account_transactions(institution_id,source_type,source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_academic_years_scope ON academic_years(institution_id,status,is_active);
CREATE INDEX IF NOT EXISTS idx_institution_classes_scope ON institution_classes(institution_id,status,sort_order);
CREATE INDEX IF NOT EXISTS idx_institution_sections_scope ON institution_sections(institution_id,class_id,status,sort_order);
CREATE INDEX IF NOT EXISTS idx_enrollments_scope ON student_enrollments(institution_id,academic_year,class_name,section,status);
CREATE INDEX IF NOT EXISTS idx_promotion_batches_scope ON promotion_batches(institution_id,promoted_at);
CREATE INDEX IF NOT EXISTS idx_promotion_items_scope ON promotion_items(institution_id,student_id,created_at);
`);
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS admin_settings(id TEXT PRIMARY KEY,application_name TEXT NOT NULL DEFAULT 'EduLedger',support_email TEXT NOT NULL DEFAULT '',currency TEXT NOT NULL DEFAULT 'INR',timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',session_timeout_minutes INTEGER NOT NULL DEFAULT 10080,updated_by TEXT,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    const additions={settings:["dise_code TEXT NOT NULL DEFAULT ''","website TEXT NOT NULL DEFAULT ''","city TEXT NOT NULL DEFAULT ''","state TEXT NOT NULL DEFAULT ''","pin_code TEXT NOT NULL DEFAULT ''","principal_name TEXT NOT NULL DEFAULT ''","registration_number TEXT NOT NULL DEFAULT ''","affiliation TEXT NOT NULL DEFAULT ''","motto TEXT NOT NULL DEFAULT ''","school_type TEXT NOT NULL DEFAULT ''","fee_receipt_title TEXT NOT NULL DEFAULT 'Fee Payment Receipt'","fee_receipt_subheader TEXT NOT NULL DEFAULT 'Standard Fee Receipt Template'","payslip_title TEXT NOT NULL DEFAULT 'Pay Slip'","payslip_subheader TEXT NOT NULL DEFAULT 'Standard Pay Slip Template'","footer_text TEXT NOT NULL DEFAULT ''","signature_label TEXT NOT NULL DEFAULT 'Authorized Signatory'"],students:["academic_year TEXT NOT NULL DEFAULT ''","leaving_date TEXT","leaving_reason TEXT NOT NULL DEFAULT ''","graduation_date TEXT"],users:["status TEXT NOT NULL DEFAULT 'Active'","last_login_at TIMESTAMPTZ"],institutions:["status TEXT NOT NULL DEFAULT 'Active'"],subscriptions:["payment_status TEXT NOT NULL DEFAULT 'Pending'","plan_type TEXT NOT NULL DEFAULT 'Yearly'","currency TEXT NOT NULL DEFAULT 'INR'","renewal_date TIMESTAMPTZ","auto_renew BOOLEAN NOT NULL DEFAULT FALSE","last_notification_sent TIMESTAMPTZ","grace_period_days INTEGER NOT NULL DEFAULT 0"],notifications:["link TEXT NOT NULL DEFAULT ''","delivery_status TEXT NOT NULL DEFAULT 'SENT'"],admin_settings:["subscription_warning_days TEXT NOT NULL DEFAULT '30,15,7,3,1,0,-1'","subscription_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE","in_app_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE","email_notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE","subscription_grace_days INTEGER NOT NULL DEFAULT 0"]} as const;
    if(sql.dialect==="sqlite"){
      for(const [table,definitions] of Object.entries(additions)){const columns=new Set((await sql.unsafe(`PRAGMA table_info(${table})`) as unknown as {name:string}[]).map(x=>x.name));for(const definition of definitions)if(!columns.has(definition.split(" ")[0]))await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN ${definition}`)}
    }else{
      for(const [table,definitions] of Object.entries(additions))for(const definition of definitions)await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${definition}`);
    }
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
export async function recordUserLogin(userId:string){await run("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?",[userId],await ready())}
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
  // Invoice and receipt columns are globally unique, while counters are scoped
  // to an institution. Include the institution ID so two schools can both use
  // their first counter value without rolling back the student/payment write.
  return `${kind}-${year}-${institutionId}-${String(result.value).padStart(6, "0")}`;
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
    diseCode: string; website: string; city: string; state: string; pinCode: string;
    principalName: string; registrationNumber: string; affiliation: string; motto: string; schoolType: string;
    feeReceiptTitle: string; feeReceiptSubheader: string; payslipTitle: string; payslipSubheader: string; footerText: string; signatureLabel: string;
  }>(
    `SELECT i.id,i.name,COALESCE(s.school_address,'') address,COALESCE(s.school_phone,'') phone,COALESCE(s.school_email,'') email,COALESCE(s.logo_url,'') AS "logoUrl",COALESCE(s.academic_year,'2026-2027') AS "academicYear",COALESCE(s.dise_code,'') AS "diseCode",COALESCE(s.website,'') website,COALESCE(s.city,'') city,COALESCE(s.state,'') state,COALESCE(s.pin_code,'') AS "pinCode",COALESCE(s.principal_name,'') AS "principalName",COALESCE(s.registration_number,'') AS "registrationNumber",COALESCE(s.affiliation,'') affiliation,COALESCE(s.motto,'') motto,COALESCE(s.school_type,'') AS "schoolType",COALESCE(s.fee_receipt_title,'Fee Payment Receipt') AS "feeReceiptTitle",COALESCE(s.fee_receipt_subheader,'Standard Fee Receipt Template') AS "feeReceiptSubheader",COALESCE(s.payslip_title,'Pay Slip') AS "payslipTitle",COALESCE(s.payslip_subheader,'Standard Pay Slip Template') AS "payslipSubheader",COALESCE(s.footer_text,'') AS "footerText",COALESCE(s.signature_label,'Authorized Signatory') AS "signatureLabel" FROM institutions i LEFT JOIN settings s ON s.institution_id=i.id WHERE i.id=?`,
    [institutionId],
    await ready(),
  );
}
export async function findUserByEmail(email: string) {
  return await row<DbUser & { passwordHash: string; status:string }>(
    'SELECT id,email,name,password_hash AS "passwordHash",role,status,institution_id AS "institutionId" FROM users WHERE email=?',
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
    account=await row<{id:string;email:string;role:string}>("SELECT id,email,role FROM users WHERE id=?",[userId],db),
    configuredId=process.env.ADMIN_USER_ID?.trim(),configuredEmail=process.env.ADMIN_EMAIL?.trim().toLowerCase(),
    isAdmin=Boolean(account&&account.role==="SUPER_ADMIN"&&(configuredId?account.id===configuredId:configuredEmail&&account.email.toLowerCase()===configuredEmail)),
    adminSettings=isAdmin?await row<{minutes:number}>('SELECT session_timeout_minutes AS minutes FROM admin_settings WHERE id=\'global\'',[],db):undefined,
    expires = new Date(Date.now() + (adminSettings?.minutes||10080) * 60_000);
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
    'SELECT u.id,u.email,u.name,u.role,u.institution_id AS "institutionId" FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>CURRENT_TIMESTAMP AND u.status=\'Active\'',
    [token],
    await ready(),
  );
}
export async function deleteSession(token: string) {
  await run("DELETE FROM sessions WHERE token=?", [token], await ready());
}
export async function deleteOtherUserSessions(userId: string, currentToken: string) {
  const result = await run(
    "DELETE FROM sessions WHERE user_id=? AND token<>?",
    [userId, currentToken],
    await ready(),
  );
  return result;
}
export async function updateUserPassword(
  userId: string,
  passwordHash: string,
  currentToken: string,
) {
  const db = await ready();
  return db.begin(async (tx) => {
    await run(
      "UPDATE users SET password_hash=? WHERE id=?",
      [passwordHash, userId],
      tx,
    );
    const result = await run(
      "DELETE FROM sessions WHERE user_id=? AND token<>?",
      [userId, currentToken],
      tx,
    );
    return result;
  });
}

const studentSelect = `SELECT s.id,s.name,s.admission,s.gender,s.date_of_birth AS "dateOfBirth",s.class_name AS "className",s.section,s.grade,s.roll_number AS "rollNumber",s.parent,s.parent_phone AS "parentPhone",s.parent_email AS "parentEmail",s.address,s.admission_date AS "admissionDate",s.attendance,s.fee,s.total_fee AS "totalFee",s.paid_fee AS "paidFee",s.pending_fee AS "pendingFee",s.status,s.academic_year AS "academicYear",s.created_at::text AS "createdAt" FROM students s`;
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
    academicYear?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const db = await ready();
  if(filters.academicYear)await ensureStudentEnrollments(institutionId,db);
  await refreshFees(institutionId, db);
  const where = ["s.institution_id=?"],
    args: unknown[] = [institutionId];
  const scopedSelect=filters.academicYear?studentSelect.replace('s.class_name AS "className",s.section','e.class_name AS "className",e.section').replace('s.academic_year AS "academicYear"','e.academic_year AS "academicYear"').replace(' FROM students s',' FROM students s JOIN student_enrollments e ON e.student_id=s.id AND e.institution_id=s.institution_id') : studentSelect;
  if(filters.academicYear){where.push("e.academic_year=?");args.push(filters.academicYear)}
  if (filters.search) {
    where.push(
      "(s.name ILIKE ? OR s.admission ILIKE ? OR s.parent_phone ILIKE ?)",
    );
    const q = `%${filters.search}%`;
    args.push(q, q, q);
  }
  for (const [k, col] of [
    ["className", filters.academicYear ? "e.class_name" : "s.class_name"],
    ["section", filters.academicYear ? "e.section" : "s.section"],
    ["fee", "s.fee"],
  ] as const)
    if (filters[k]) {
      where.push(`${col}=?`);
      args.push(filters[k]);
    }
  let query = `${scopedSelect} WHERE ${where.join(" AND ")} ORDER BY s.created_at DESC`;
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
      "INSERT INTO students(id,institution_id,name,admission,gender,date_of_birth,class_name,section,grade,roll_number,parent,parent_phone,parent_email,address,admission_date,total_fee,paid_fee,pending_fee,attendance,fee,status,academic_year)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
        input.academicYear,
      ],
      tx,
    );
    await run("INSERT INTO student_enrollments(id,institution_id,student_id,academic_year,class_name,section,status)VALUES(?,?,?,?,?,?,'Active')",[randomUUID(),institutionId,id,input.academicYear,input.className,input.section],tx);
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
    "UPDATE students SET name=?,admission=?,gender=?,date_of_birth=?,class_name=?,section=?,grade=?,roll_number=?,parent=?,parent_phone=?,parent_email=?,address=?,admission_date=?,academic_year=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND institution_id=?",
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
      value.academicYear,
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
  academicYear?: string,
) {
  const db=await ready();if(academicYear)await ensureStudentEnrollments(institutionId,db);
  return await rows<{
    studentId: string;
    name: string;
    admission: string;
    className: string;
    section: string;
    status: string;
    remarks: string;
  }>(
    academicYear?"SELECT s.id AS \"studentId\",s.name,s.admission,e.class_name AS \"className\",e.section,COALESCE(a.status,'Present') status,COALESCE(a.remarks,'') remarks FROM student_enrollments e JOIN students s ON s.id=e.student_id LEFT JOIN attendance a ON a.student_id=s.id AND a.date=? WHERE e.institution_id=? AND e.academic_year=? AND e.class_name=? AND e.section=? AND LOWER(s.status)='active' ORDER BY s.name":"SELECT s.id AS \"studentId\",s.name,s.admission,s.class_name AS \"className\",s.section,COALESCE(a.status,'Present') status,COALESCE(a.remarks,'') remarks FROM students s LEFT JOIN attendance a ON a.student_id=s.id AND a.date=? WHERE s.institution_id=? AND s.class_name=? AND s.section=? AND s.status='Active' ORDER BY s.name",
    academicYear?[date,institutionId,academicYear,className,section]:[date, institutionId, className, section],
    db,
  );
}
export async function listAttendance(
  institutionId: string,
  filters: {
    date?: string;
    className?: string;
    section?: string;
    status?: string;
    academicYear?: string;
  } = {},
) {
  const db=await ready(),where = ["a.institution_id=?"],
    args: unknown[] = [institutionId];
  if(filters.academicYear){await ensureStudentEnrollments(institutionId,db);const year=await row<{startMonth:number;endMonth:number}>('SELECT start_month AS "startMonth",end_month AS "endMonth" FROM academic_years WHERE institution_id=? AND name=?',[institutionId,filters.academicYear],db),startYear=Number(filters.academicYear.slice(0,4)),startMonth=year?.startMonth||4,endMonth=year?.endMonth||3,endYear=endMonth<startMonth?startYear+1:startYear,start=`${startYear}-${String(startMonth).padStart(2,'0')}-01`,endDate=new Date(Date.UTC(endYear,endMonth,0)).toISOString().slice(0,10);where.push("e.academic_year=?","a.date>=?","a.date<=?");args.push(filters.academicYear,start,endDate)}
  for (const [k, col] of [
    ["date", "a.date"],
    ["className", filters.academicYear?"e.class_name":"s.class_name"],
    ["section", filters.academicYear?"e.section":"s.section"],
    ["status", "a.status"],
  ] as const)
    if (filters[k]) {
      where.push(`${col}=?`);
      args.push(filters[k]);
    }
  return await rows(
    `SELECT a.id,a.date,s.name AS "studentName",s.admission,${filters.academicYear?'e.class_name':'s.class_name'} AS "className",${filters.academicYear?'e.section':'s.section'} AS section,a.status,a.remarks,a.marked_by AS "markedBy" FROM attendance a JOIN students s ON s.id=a.student_id ${filters.academicYear?'JOIN student_enrollments e ON e.student_id=s.id AND e.institution_id=s.institution_id':''} WHERE ${where.join(" AND ")} ORDER BY a.date DESC,s.name`,
    args,
    db,
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
    academicYear?: string;
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
  if (filters.academicYear) {
    where.push("f.academic_year=?");
    args.push(filters.academicYear);
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

const paymentSelect = `SELECT p.id,p.fee_id AS "feeId",p.student_id AS "studentId",s.name AS "studentName",s.admission,s.class_name AS "className",s.section,s.roll_number AS "rollNumber",s.parent,f.invoice_number AS "invoiceNumber",f.fee_type AS "feeType",f.academic_year AS "academicYear",f.discount,f.final_amount AS "finalAmount",p.receipt_number AS "receiptNumber",p.amount,p.payment_method AS method,p.transaction_id AS "transactionId",p.payment_date AS "paymentDate",p.status,p.notes,(SELECT COALESCE(SUM(p2.amount),0) FROM payments p2 WHERE p2.fee_id=p.fee_id AND (p2.created_at,p2.id)<(p.created_at,p.id)) AS "previouslyPaid",(SELECT COALESCE(SUM(p2.amount),0) FROM payments p2 WHERE p2.fee_id=p.fee_id AND (p2.created_at,p2.id)<=(p.created_at,p.id)) AS "totalPaid",(f.final_amount-(SELECT COALESCE(SUM(p2.amount),0) FROM payments p2 WHERE p2.fee_id=p.fee_id AND (p2.created_at,p2.id)<=(p.created_at,p.id))) AS "remainingBalance",p.created_at::text AS "createdAt" FROM payments p JOIN students s ON s.id=p.student_id JOIN fees f ON f.id=p.fee_id`;
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
export async function getReceiptForAdmin(receipt:string){return row<DbPayment&{institutionId:string}>(`${paymentSelect.replace("SELECT p.id","SELECT p.institution_id AS \"institutionId\",p.id")} WHERE p.receipt_number=?`,[receipt],await ready())}
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
    academicYear?: string;
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
  if (filters.academicYear) {
    where.push("f.academic_year=?");
    args.push(filters.academicYear);
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
      'SELECT COALESCE(SUM(CASE WHEN payment_date=? THEN amount ELSE 0 END),0) today,COALESCE(SUM(CASE WHEN SUBSTRING(payment_date,1,7)=? THEN amount ELSE 0 END),0) AS "month",COUNT(*)::int transactions FROM payments WHERE institution_id=? AND status=\'Success\'',
      [today, month, institutionId],
      db,
    ),
    rows<{ month: string; amount: number }>(
      'SELECT SUBSTRING(payment_date,1,7) AS "month",SUM(amount) amount FROM payments WHERE institution_id=? AND status=\'Success\' GROUP BY SUBSTRING(payment_date,1,7) ORDER BY "month" DESC LIMIT 12',
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

export type CompleteSettingsInput = {
  name:string; academicYear:string; startMonth:number; endMonth:number;
  address:string; phone:string; email:string; diseCode:string; website:string; city:string; state:string; pinCode:string;
  principalName:string; registrationNumber:string; affiliation:string; motto:string; schoolType:string;
  feeReceiptTitle:string; feeReceiptSubheader:string; payslipTitle:string; payslipSubheader:string; footerText:string; signatureLabel:string;
  academicYears:{name:string;startMonth:number;endMonth:number;status:"Active"|"Archived"}[];
  classes:{name:string;sections:string[]}[];
};

export async function getCompleteSettings(institutionId:string) {
  const db=await ready(), institution=await getInstitution(institutionId);
  await run("INSERT INTO academic_years(id,institution_id,name,start_month,end_month,status,is_active)VALUES(?,?,?,?,?,'Active',TRUE) ON CONFLICT(institution_id,name) DO NOTHING",[randomUUID(),institutionId,institution.academicYear,4,3],db);
  const existing=await row<{count:number}>("SELECT COUNT(*)::int count FROM institution_classes WHERE institution_id=?",[institutionId],db);
  if(!existing.count){
    const names=await rows<{name:string}>("SELECT DISTINCT name FROM classes WHERE institution_id=? ORDER BY name",[institutionId],db);
    const seed=names.length?names.map(x=>x.name):STANDARD_CLASSES.map(x=>x.name);
    for(const [index,name] of seed.entries()) await run("INSERT INTO institution_classes(id,institution_id,name,sort_order)VALUES(?,?,?,?) ON CONFLICT(institution_id,name) DO NOTHING",[randomUUID(),institutionId,name,index],db);
  }
  const years=await rows<{name:string;startMonth:number;endMonth:number;status:"Active"|"Archived";isActive:boolean}>('SELECT name,start_month AS "startMonth",end_month AS "endMonth",status,is_active AS "isActive" FROM academic_years WHERE institution_id=? ORDER BY name DESC',[institutionId],db);
  const classRows=await rows<{id:string;name:string;status:string}>('SELECT id,name,status FROM institution_classes WHERE institution_id=? ORDER BY sort_order,name',[institutionId],db);
  const sectionRows=await rows<{classId:string;name:string}>('SELECT class_id AS "classId",name FROM institution_sections WHERE institution_id=? AND status=\'Active\' ORDER BY sort_order,name',[institutionId],db);
  const assets=await rows<{kind:string}>('SELECT kind FROM school_assets WHERE institution_id=?',[institutionId],db);
  const legacy=await rows<{name:string;section:string}>('SELECT DISTINCT name,section FROM classes WHERE institution_id=? AND academic_year=? ORDER BY name,section',[institutionId,institution.academicYear],db);
  return { ...institution, logoUrl:assets.some(x=>x.kind==='logo')?"/api/settings/assets/logo":"", signatureUrl:assets.some(x=>x.kind==='signature')?"/api/settings/assets/signature":"", years, classes:classRows.map(item=>({id:item.id,name:item.name,active:item.status==='Active',sections:Array.from(new Set([...sectionRows.filter(x=>x.classId===item.id).map(x=>x.name),...legacy.filter(x=>x.name===item.name).map(x=>x.section)]))})) };
}

export async function saveCompleteSettings(institutionId:string,userId:string,input:CompleteSettingsInput){
  const db=await ready();
  await db.begin(async tx=>{
    await run("UPDATE institutions SET name=? WHERE id=?",[input.name,institutionId],tx);
    await run(`INSERT INTO settings(institution_id,academic_year,school_address,school_phone,school_email,dise_code,website,city,state,pin_code,principal_name,registration_number,affiliation,motto,school_type,fee_receipt_title,fee_receipt_subheader,payslip_title,payslip_subheader,footer_text,signature_label) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(institution_id) DO UPDATE SET academic_year=EXCLUDED.academic_year,school_address=EXCLUDED.school_address,school_phone=EXCLUDED.school_phone,school_email=EXCLUDED.school_email,dise_code=EXCLUDED.dise_code,website=EXCLUDED.website,city=EXCLUDED.city,state=EXCLUDED.state,pin_code=EXCLUDED.pin_code,principal_name=EXCLUDED.principal_name,registration_number=EXCLUDED.registration_number,affiliation=EXCLUDED.affiliation,motto=EXCLUDED.motto,school_type=EXCLUDED.school_type,fee_receipt_title=EXCLUDED.fee_receipt_title,fee_receipt_subheader=EXCLUDED.fee_receipt_subheader,payslip_title=EXCLUDED.payslip_title,payslip_subheader=EXCLUDED.payslip_subheader,footer_text=EXCLUDED.footer_text,signature_label=EXCLUDED.signature_label,updated_at=CURRENT_TIMESTAMP`,[institutionId,input.academicYear,input.address,input.phone,input.email,input.diseCode,input.website,input.city,input.state,input.pinCode,input.principalName,input.registrationNumber,input.affiliation,input.motto,input.schoolType,input.feeReceiptTitle,input.feeReceiptSubheader,input.payslipTitle,input.payslipSubheader,input.footerText,input.signatureLabel],tx);
    await run("UPDATE academic_years SET is_active=FALSE WHERE institution_id=?",[institutionId],tx);
    for(const year of input.academicYears) await run("INSERT INTO academic_years(id,institution_id,name,start_month,end_month,status,is_active)VALUES(?,?,?,?,?,?,?) ON CONFLICT(institution_id,name) DO UPDATE SET start_month=EXCLUDED.start_month,end_month=EXCLUDED.end_month,status=EXCLUDED.status,is_active=EXCLUDED.is_active,updated_at=CURRENT_TIMESTAMP",[randomUUID(),institutionId,year.name,year.startMonth,year.endMonth,year.status,year.name===input.academicYear],tx);
    for(const [order,item] of input.classes.entries()){
      const saved=await row<{id:string}>("INSERT INTO institution_classes(id,institution_id,name,sort_order,status)VALUES(?,?,?,?,'Active') ON CONFLICT(institution_id,name) DO UPDATE SET sort_order=EXCLUDED.sort_order,status='Active',updated_at=CURRENT_TIMESTAMP RETURNING id",[randomUUID(),institutionId,item.name,order],tx);
      for(const [sectionOrder,name] of item.sections.entries()) await run("INSERT INTO institution_sections(id,institution_id,class_id,name,sort_order,status)VALUES(?,?,?,?,?,'Active') ON CONFLICT(class_id,name) DO UPDATE SET sort_order=EXCLUDED.sort_order,status='Active',updated_at=CURRENT_TIMESTAMP",[randomUUID(),institutionId,saved.id,name,sectionOrder],tx);
      const keptSections=item.sections.length?item.sections:["__none__"];
      await run(`UPDATE institution_sections SET status='Inactive' WHERE institution_id=? AND class_id=? AND name NOT IN (${keptSections.map(()=>"?").join(",")})`,[institutionId,saved.id,...keptSections],tx);
    }
    const keptClasses=input.classes.length?input.classes.map(x=>x.name):["__none__"];
    await run(`UPDATE institution_classes SET status='Inactive' WHERE institution_id=? AND name NOT IN (${keptClasses.map(()=>"?").join(",")})`,[institutionId,...keptClasses],tx);
    await audit(institutionId,userId,"Institution Settings Updated","Settings",institutionId,{academicYear:input.academicYear,classCount:input.classes.length},tx);
  });
  return getCompleteSettings(institutionId);
}

export async function putSchoolAsset(institutionId:string,userId:string,kind:"logo"|"signature",mimeType:string,data:Buffer){const db=await ready();await run("INSERT INTO school_assets(id,institution_id,kind,mime_type,data,size_bytes)VALUES(?,?,?,?,?,?) ON CONFLICT(institution_id,kind) DO UPDATE SET mime_type=EXCLUDED.mime_type,data=EXCLUDED.data,size_bytes=EXCLUDED.size_bytes,updated_at=CURRENT_TIMESTAMP",[randomUUID(),institutionId,kind,mimeType,data,data.length],db);await audit(institutionId,userId,`${kind==='logo'?'Logo':'Signature'} Updated`,"SchoolAsset",kind,{},db)}
export async function getSchoolAsset(institutionId:string,kind:"logo"|"signature"){return row<{mimeType:string;data:Buffer}>('SELECT mime_type AS "mimeType",data FROM school_assets WHERE institution_id=? AND kind=?',[institutionId,kind],await ready())}
export async function deleteSchoolAsset(institutionId:string,userId:string,kind:"logo"|"signature"){const db=await ready();await run("DELETE FROM school_assets WHERE institution_id=? AND kind=?",[institutionId,kind],db);await audit(institutionId,userId,`${kind==='logo'?'Logo':'Signature'} Removed`,"SchoolAsset",kind,{},db)}

export async function listArchivedStudents(institutionId:string,status:"Left"|"Graduated"){return rows(`${studentSelect.replace(' FROM students s',',s.leaving_date AS "leavingDate",s.leaving_reason AS "reason",s.graduation_date AS "graduationDate" FROM students s')} WHERE s.institution_id=? AND LOWER(s.status)=LOWER(?) ORDER BY s.name`,[institutionId,status],await ready())}

export type PromotionInput={sourceYear:string;targetYear:string;sourceClass:string;sourceSection:string;targetClass:string;targetSection:string;studentIds:string[]};
async function ensureStudentEnrollments(institutionId:string,sql?:Sql){const db=sql??await ready();await run("INSERT INTO student_enrollments(id,institution_id,student_id,academic_year,class_name,section,status) SELECT 'legacy-'||s.id||'-'||s.academic_year,s.institution_id,s.id,s.academic_year,s.class_name,s.section,CASE WHEN LOWER(s.status)='active' THEN 'Active' ELSE s.status END FROM students s WHERE s.institution_id=? AND s.academic_year<>'' ON CONFLICT(institution_id,student_id,academic_year) DO NOTHING",[institutionId],db)}
export async function promotionOptions(institutionId:string){const db=await ready();await ensureStudentEnrollments(institutionId,db);const settings=await getCompleteSettings(institutionId);return {years:settings.years.filter(x=>x.status==='Active').map(x=>x.name),classes:settings.classes.filter(x=>x.active).map(x=>({name:x.name,sections:x.sections}))}}
export async function promotionCandidates(institutionId:string,sourceYear:string,sourceClass:string,sourceSection:string){await ensureStudentEnrollments(institutionId);return rows<{id:string;name:string;admission:string;parent:string;parentPhone:string;className:string;section:string;academicYear:string;status:string}>('SELECT s.id,s.name,s.admission,s.parent,s.parent_phone AS "parentPhone",e.class_name AS "className",e.section,e.academic_year AS "academicYear",s.status FROM student_enrollments e JOIN students s ON s.id=e.student_id WHERE e.institution_id=? AND e.academic_year=? AND e.class_name=? AND e.section=? ORDER BY s.name',[institutionId,sourceYear,sourceClass,sourceSection],await ready())}
export async function validatePromotion(institutionId:string,input:PromotionInput,sql?:Sql){const db=sql??await ready();await ensureStudentEnrollments(institutionId,db);const errors:string[]=[];if(input.sourceYear===input.targetYear)errors.push("Source and target academic years must be different.");const years=await rows<{name:string}>("SELECT name FROM academic_years WHERE institution_id=? AND status='Active' AND name IN (?,?)",[institutionId,input.sourceYear,input.targetYear],db);if(years.length!==2)errors.push("Source or target academic year is unavailable.");const configs=await rows<{name:string}>("SELECT name FROM institution_classes WHERE institution_id=? AND status='Active' AND name IN (?,?)",[institutionId,input.sourceClass,input.targetClass],db);if(new Set(configs.map(x=>x.name)).size!==new Set([input.sourceClass,input.targetClass]).size)errors.push("Source or target class is not configured.");for(const [className,section] of [[input.sourceClass,input.sourceSection],[input.targetClass,input.targetSection]])if(section){const valid=await row<{count:number}>("SELECT COUNT(*)::int count FROM institution_sections x JOIN institution_classes c ON c.id=x.class_id WHERE x.institution_id=? AND c.name=? AND x.name=? AND x.status='Active'",[institutionId,className,section],db);if(!valid.count)errors.push(`Section ${section} does not belong to ${className}.`)}
 const selected=Array.from(new Set(input.studentIds));if(!selected.length)errors.push("Select at least one student.");const items:selectedPromotionItem[]=selected.length?await rows(`SELECT s.id,s.name,s.admission,s.status,e.id AS "sourceEnrollmentId",e.class_name AS "previousClass",e.section AS "previousSection",e.academic_year AS "previousYear",CASE WHEN LOWER(s.status)<>'active' THEN 'Ineligible' WHEN target.id IS NOT NULL THEN 'Already promoted' ELSE 'Ready' END AS "promotionStatus" FROM students s JOIN student_enrollments e ON e.student_id=s.id AND e.institution_id=s.institution_id LEFT JOIN student_enrollments target ON target.student_id=s.id AND target.institution_id=s.institution_id AND target.academic_year=? WHERE s.institution_id=? AND s.id IN (${selected.map(()=>'?').join(',')}) AND e.academic_year=? AND e.class_name=? AND e.section=?`,[input.targetYear,institutionId,...selected,input.sourceYear,input.sourceClass,input.sourceSection],db):[];if(items.length!==selected.length)errors.push("Some selected students no longer belong to the source class or school.");return {valid:errors.length===0&&items.every(x=>x.promotionStatus==='Ready'),errors,items:items.map(x=>({...x,newYear:input.targetYear,newClass:input.targetClass,newSection:input.targetSection})),summary:{selected:selected.length,eligible:items.filter(x=>x.promotionStatus==='Ready').length,alreadyPromoted:items.filter(x=>x.promotionStatus==='Already promoted').length,errors:errors.length+items.filter(x=>x.promotionStatus==='Ineligible').length}}}
type selectedPromotionItem={id:string;name:string;admission:string;status:string;sourceEnrollmentId:string;previousClass:string;previousSection:string;previousYear:string;promotionStatus:string};
export async function promoteStudents(institutionId:string,userId:string,input:PromotionInput){const db=await ready(),batchId=randomUUID();let promoted=0;await db.begin(async tx=>{const preview=await validatePromotion(institutionId,input,tx);if(!preview.valid)throw new Error(preview.errors[0]||preview.items.find(x=>x.promotionStatus!=='Ready')?.promotionStatus||"Promotion validation failed.");await run("INSERT INTO promotion_batches(id,institution_id,source_academic_year,target_academic_year,source_class,source_section,target_class,target_section,promoted_by,status)VALUES(?,?,?,?,?,?,?,?,?,'Completed')",[batchId,institutionId,input.sourceYear,input.targetYear,input.sourceClass,input.sourceSection,input.targetClass,input.targetSection,userId],tx);for(const item of preview.items){const targetId=randomUUID();await run("INSERT INTO student_enrollments(id,institution_id,student_id,academic_year,class_name,section,status,promoted_from_enrollment_id,promoted_at,promoted_by)VALUES(?,?,?,?,?,?,'Active',?,CURRENT_TIMESTAMP,?)",[targetId,institutionId,item.id,input.targetYear,input.targetClass,input.targetSection,item.sourceEnrollmentId,userId],tx);await run("UPDATE student_enrollments SET status='Promoted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND institution_id=?",[item.sourceEnrollmentId,institutionId],tx);await run("UPDATE students SET academic_year=?,class_name=?,section=?,grade=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND institution_id=?",[input.targetYear,input.targetClass,input.targetSection,`${input.targetClass}${input.targetSection?`-${input.targetSection}`:''}`,item.id,institutionId],tx);await run("INSERT INTO promotion_items(id,batch_id,institution_id,student_id,source_enrollment_id,target_enrollment_id,status)VALUES(?,?,?,?,?,?,'Promoted')",[randomUUID(),batchId,institutionId,item.id,item.sourceEnrollmentId,targetId],tx);promoted++}await audit(institutionId,userId,"Students Promoted","PromotionBatch",batchId,{...input,studentIds:undefined,count:promoted},tx)});return {batchId,promoted}}
export async function listPromotionHistory(institutionId:string,search=""){const q=`%${search}%`;return rows('SELECT pi.id,pi.student_id AS "studentId",s.name AS "studentName",s.admission,se.class_name AS "previousClass",se.section AS "previousSection",se.academic_year AS "previousYear",te.class_name AS "newClass",te.section AS "newSection",te.academic_year AS "newYear",u.name AS "promotedBy",pb.promoted_at::text AS "promotedAt",pi.status FROM promotion_items pi JOIN promotion_batches pb ON pb.id=pi.batch_id JOIN students s ON s.id=pi.student_id JOIN student_enrollments se ON se.id=pi.source_enrollment_id JOIN student_enrollments te ON te.id=pi.target_enrollment_id JOIN users u ON u.id=pb.promoted_by WHERE pi.institution_id=? AND (s.name ILIKE ? OR s.admission ILIKE ?) ORDER BY pb.promoted_at DESC',[institutionId,q,q],await ready())}
export async function studentAcademicHistory(institutionId:string,studentId:string){return rows('SELECT e.id,e.academic_year AS "academicYear",e.class_name AS "className",e.section,e.status,e.promoted_at::text AS "promotedAt",u.name AS "promotedBy" FROM student_enrollments e LEFT JOIN users u ON u.id=e.promoted_by WHERE e.institution_id=? AND e.student_id=? ORDER BY e.academic_year DESC',[institutionId,studentId],await ready())}
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
      'SELECT s.status,s.plan_id AS "planId",p.name AS "planName",s.student_capacity AS "studentCapacity",s.amount_paid AS "amountPaid",s.activation_date::text AS "activationDate",s.expiry_date::text AS "expiryDate",s.razorpay_order_id AS "razorpayOrderId",s.razorpay_payment_id AS "razorpayPaymentId",s.razorpay_signature AS "razorpaySignature",s.currency,s.payment_status AS "paymentStatus",s.auto_renew AS "autoRenew" FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.institution_id=? ORDER BY CASE WHEN s.status IN (\'ACTIVE\',\'EXPIRING_SOON\') AND s.expiry_date>CURRENT_TIMESTAMP THEN 0 ELSE 1 END,s.created_at DESC LIMIT 1',
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
      daysRemaining: 0,
      durationProgress: 0,
      currency: "INR",
      paymentStatus: "Unpaid",
      autoRenew: false,
    };
  const status = effectiveStatus(item.status, item.expiryDate ?? undefined);
  if (status !== item.status)
    await run(
      "UPDATE subscriptions SET status=?,updated_at=CURRENT_TIMESTAMP WHERE razorpay_order_id=?",
      [status, item.razorpayOrderId],
      db,
    );
  const daysRemaining=getDaysRemaining(item.expiryDate??undefined),start=item.activationDate?new Date(item.activationDate).getTime():0,end=item.expiryDate?new Date(item.expiryDate).getTime():0,durationProgress=start&&end>start?Math.max(0,Math.min(100,Math.round((Date.now()-start)/(end-start)*100))):0;
  return { ...item, status, studentUsage: usage,daysRemaining,durationProgress,autoRenew:Boolean(item.autoRenew) };
}
export async function hasActiveSubscription(institutionId: string) {
  return isSubscriptionActive((await getSubscription(institutionId)).status);
}
export async function assertStudentCapacity(
  institutionId: string,
  additional = 1,
) {
  const item = await getSubscription(institutionId);
  if (!isSubscriptionActive(item.status) || !item.studentCapacity)
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
      "UPDATE subscriptions SET status='ACTIVE',payment_status='Paid',activation_date=?,expiry_date=?,renewal_date=?,razorpay_payment_id=?,razorpay_signature=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [now, expiry, expiry, paymentId, signature, item.id],
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

export async function listUserNotifications(userId:string,limit=50){const db=await ready(),items=await rows<Record<string,unknown>>('SELECT id,type,title,description,link,delivery_status AS "deliveryStatus",read_at::text AS "readAt",created_at::text AS "createdAt" FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ?',[userId,Math.min(Math.max(limit,1),100)],db),unread=(await row<{count:number}>('SELECT COUNT(*)::int count FROM notifications WHERE user_id=? AND read_at IS NULL',[userId],db)).count;return{items,unread}}
export async function markUserNotificationRead(userId:string,id?:string){const db=await ready();return id?run('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND read_at IS NULL',[id,userId],db):run('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL',[userId],db)}

export async function processSubscriptionLifecycle(now=new Date()){
 const db=await ready(),logId=randomUUID(),timestamp=now.toISOString();await run("INSERT INTO subscription_processing_logs(id,status)VALUES(?,'RUNNING')",[logId],db);
 let checked=0,expired=0,notifications=0;
 try{
  const settings=await row<{days:string;enabled:boolean;inApp:boolean}>('SELECT subscription_warning_days AS days,subscription_notifications_enabled AS enabled,in_app_notifications_enabled AS "inApp" FROM admin_settings WHERE id=\'global\'',[],db),schedule=(settings?.days||'30,15,7,3,1,0,-1').split(',').map(Number).filter(Number.isFinite),subscriptions=await rows<{id:string;institutionId:string;planName:string;expiryDate:string;status:string}>('SELECT s.id,s.institution_id AS "institutionId",p.name AS "planName",s.expiry_date::text AS "expiryDate",s.status FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.payment_status=\'Paid\' AND s.expiry_date IS NOT NULL AND s.status NOT IN (\'CANCELLED\',\'SUSPENDED\',\'REFUNDED\',\'FAILED\')',[],db);
  for(const subscription of subscriptions){checked++;const days=Math.ceil((new Date(subscription.expiryDate).getTime()-now.getTime())/864e5),status=getSubscriptionStatus(subscription.status,subscription.expiryDate,now,Math.max(...schedule.filter(x=>x>=0),30));if(status!==subscription.status){await run('UPDATE subscriptions SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[status,subscription.id],db);if(status==='EXPIRED')expired++}if(!settings?.enabled||!settings.inApp)continue;const milestone=days<0?'expired':String(days);if(!schedule.includes(days)&&!(days<0&&schedule.includes(-1)))continue;const inserted=await run("INSERT INTO subscription_notification_events(id,subscription_id,institution_id,milestone,status,sent_at)VALUES(?,?,?,?, 'SENT',?) ON CONFLICT(subscription_id,milestone) DO NOTHING",[randomUUID(),subscription.id,subscription.institutionId,milestone,timestamp],db);if(!inserted)continue;const users=await rows<{id:string;name:string}>('SELECT id,name FROM users WHERE institution_id=? AND status=\'Active\'',[subscription.institutionId],db),expiryLabel=new Intl.DateTimeFormat('en-IN',{dateStyle:'long',timeZone:'UTC'}).format(new Date(subscription.expiryDate)),isExpired=days<0;for(const user of users)await run('INSERT INTO notifications(id,institution_id,user_id,type,title,description,link,delivery_status)VALUES(?,?,?,?,?,?,?,\'SENT\')',[randomUUID(),subscription.institutionId,user.id,isExpired?'subscription_expired':'subscription_expiry',isExpired?'Your EduLedger subscription has expired':'Your EduLedger plan expires soon',isExpired?`Hello ${user.name}, your ${subscription.planName} subscription expired on ${expiryLabel}. Please renew your plan to restore access to premium features.`:`Hello ${user.name}, your ${subscription.planName} subscription will expire on ${expiryLabel}. You have ${Math.max(days,0)} day${days===1?'':'s'} remaining. Please renew your plan to continue using EduLedger.`,'/subscription'],db);notifications+=users.length}await run("UPDATE subscription_processing_logs SET status='COMPLETED',finished_at=CURRENT_TIMESTAMP,checked_count=?,expired_count=?,notification_count=? WHERE id=?",[checked,expired,notifications,logId],db);return{checked,expired,notifications,processedAt:timestamp}
 }catch(error){await run("UPDATE subscription_processing_logs SET status='FAILED',finished_at=CURRENT_TIMESTAMP,checked_count=?,expired_count=?,notification_count=?,error=? WHERE id=?",[checked,expired,notifications,error instanceof Error?error.message:'Unknown lifecycle error',logId],db);throw error}
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

export const STANDARD_CLASSES = [
  { name: "LKG", slug: "lkg", description: "Lower Kindergarten", sections: 2 },
  { name: "UKG", slug: "ukg", description: "Upper Kindergarten", sections: 2 },
  ...Array.from({ length: 10 }, (_, index) => ({
    name: `Class ${index + 1}`,
    slug: `class-${index + 1}`,
    description: index < 5 ? "Primary School" : "High School",
    sections: 3,
  })),
] as const;

export function classFromSlug(slug: string) {
  return STANDARD_CLASSES.find((item) => item.slug === slug);
}

async function ensureStandardClasses(institutionId: string, academicYear: string) {
  const db = await ready();
  for (const item of STANDARD_CLASSES) {
    for (let index = 0; index < item.sections; index++) {
      await run(
        "INSERT INTO classes(id,institution_id,name,section,teacher,academic_year,capacity,status)VALUES(?,?,?,?,?,?,40,'Active') ON CONFLICT(institution_id,name,section,academic_year) DO NOTHING",
        [randomUUID(), institutionId, item.name, String.fromCharCode(65 + index), "", academicYear],
        db,
      );
    }
  }
}

export async function listClassSummaries(institutionId: string, academicYear?: string) {
  const year = academicYear ?? (await getInstitution(institutionId)).academicYear;
  await ensureStandardClasses(institutionId, year);
  const [classes, students, teachers] = await Promise.all([
    rows<{ name: string; section: string; teacher: string; status: string }>(
      "SELECT name,section,teacher,status FROM classes WHERE institution_id=? AND academic_year=?",
      [institutionId, year], await ready()),
    rows<{ className: string; count: number }>(
      'SELECT class_name AS "className",COUNT(*)::int count FROM students WHERE institution_id=? AND status=\'Active\' GROUP BY class_name',
      [institutionId], await ready()),
    listTeachers(institutionId),
  ]);
  return STANDARD_CLASSES.map((definition) => {
    const sections = classes.filter((item) => item.name === definition.name);
    const assigned = teachers.filter((teacher) => teacher.classes.split(",").some((value) => value.trim().startsWith(definition.name)));
    return {
      ...definition,
      academicYear: year,
      studentCount: students.find((item) => item.className === definition.name)?.count ?? 0,
      teacherCount: assigned.length,
      classTeacher: sections.find((item) => item.teacher)?.teacher || "Not Assigned",
      sectionCount: sections.length,
      status: sections.some((item) => item.status === "Active") ? "Active" : "Inactive",
    };
  });
}

export async function getClassWorkspace(institutionId: string, slug: string, academicYear?: string) {
  const definition = classFromSlug(slug);
  if (!definition) return null;
  const year = academicYear ?? (await getInstitution(institutionId)).academicYear;
  const summaries = await listClassSummaries(institutionId, year);
  const summary = summaries.find((item) => item.slug === slug)!;
  const [sections, students, teachers, attendance, fees, payments, timetable, exams, results] = await Promise.all([
    rows('SELECT id,name,section,teacher,capacity,status FROM classes WHERE institution_id=? AND name=? AND academic_year=? ORDER BY section', [institutionId, definition.name, year], await ready()),
    listStudents(institutionId, { className: definition.name, limit: 1000 }),
    listTeachers(institutionId),
    listAttendance(institutionId, { className: definition.name }),
    listFees(institutionId, { className: definition.name }),
    listPayments(institutionId, { className: definition.name }),
    rows('SELECT t.id,t.section,t.subject,t.weekday,t.start_time AS "startTime",t.end_time AS "endTime",COALESCE(te.name,\'Unassigned\') AS "teacherName",t.teacher_id AS "teacherId" FROM timetable_entries t LEFT JOIN teachers te ON te.id=t.teacher_id WHERE t.institution_id=? AND t.class_name=? AND t.academic_year=? ORDER BY t.weekday,t.start_time', [institutionId, definition.name, year], await ready()),
    rows('SELECT id,name,exam_date AS "examDate",section,subject,max_marks AS "maxMarks",passing_marks AS "passingMarks" FROM class_exams WHERE institution_id=? AND class_name=? AND academic_year=? ORDER BY exam_date DESC', [institutionId, definition.name, year], await ready()),
    rows('SELECT r.id,r.exam_id AS "examId",r.student_id AS "studentId",s.name AS "studentName",e.subject,r.marks,r.grade,r.status FROM class_results r JOIN students s ON s.id=r.student_id JOIN class_exams e ON e.id=r.exam_id WHERE r.institution_id=? AND e.class_name=? AND e.academic_year=? ORDER BY e.exam_date DESC,s.name', [institutionId, definition.name, year], await ready()),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const todayAttendance = (attendance as { date: string; status: string }[]).filter((item) => item.date.slice(0, 10) === today);
  return { summary, sections, students, teachers, attendance, fees, payments, timetable, exams, results,
    metrics: {
      present: todayAttendance.filter((item) => item.status === "Present").length,
      absent: todayAttendance.filter((item) => item.status === "Absent").length,
      totalFees: (fees as { totalAmount: number }[]).reduce((sum, item) => sum + Number(item.totalAmount), 0),
      paidFees: (fees as { paidAmount: number }[]).reduce((sum, item) => sum + Number(item.paidAmount), 0),
      pendingFees: (fees as { pendingAmount: number }[]).reduce((sum, item) => sum + Number(item.pendingAmount), 0),
    }
  };
}

export async function addClassSection(institutionId: string, className: string, academicYear: string, section: string, teacher: string, capacity: number, userId: string) {
  const definition = STANDARD_CLASSES.find((item) => item.name === className);
  if (!definition) throw new Error("Invalid class");
  const item = await saveClass(institutionId, { name: className, section, teacher, academicYear, capacity, status: "Active" }, userId);
  return item;
}

export async function deleteClassSection(institutionId: string, id: string, userId: string) {
  const db = await ready();
  const item = await row<{ name: string; section: string }>('SELECT name,section FROM classes WHERE id=? AND institution_id=?', [id, institutionId], db);
  if (!item) throw new Error("Section not found");
  const active = await row<{ count: number }>('SELECT COUNT(*)::int count FROM students WHERE institution_id=? AND class_name=? AND section=? AND status=\'Active\'', [institutionId, item.name, item.section], db);
  if (active.count) throw new Error("Section contains active students");
  await run('DELETE FROM classes WHERE id=? AND institution_id=?', [id, institutionId], db);
  await audit(institutionId, userId, "Section Deleted", "Class", id, item, db);
}

export async function addTimetableEntry(institutionId: string, className: string, academicYear: string, input: { section: string; subject: string; teacherId?: string; weekday: number; startTime: string; endTime: string }) {
  const id = randomUUID();
  await run('INSERT INTO timetable_entries(id,institution_id,class_name,section,academic_year,subject,teacher_id,weekday,start_time,end_time)VALUES(?,?,?,?,?,?,?,?,?,?)', [id,institutionId,className,input.section,academicYear,input.subject,input.teacherId || null,input.weekday,input.startTime,input.endTime], await ready());
  return id;
}

export async function addClassExam(institutionId: string, className: string, academicYear: string, input: { name: string; examDate: string; section: string; subject: string; maxMarks: number; passingMarks: number }) {
  const id = randomUUID();
  await run('INSERT INTO class_exams(id,institution_id,class_name,section,academic_year,name,exam_date,subject,max_marks,passing_marks)VALUES(?,?,?,?,?,?,?,?,?,?)', [id,institutionId,className,input.section,academicYear,input.name,input.examDate,input.subject,input.maxMarks,input.passingMarks], await ready());
  return id;
}

export async function addClassResult(institutionId: string, examId: string, studentId: string, marks: number) {
  const exam = await row<{ maxMarks: number; passingMarks: number }>('SELECT max_marks AS "maxMarks",passing_marks AS "passingMarks" FROM class_exams WHERE id=? AND institution_id=?', [examId,institutionId], await ready());
  if (!exam || marks < 0 || marks > exam.maxMarks) throw new Error("Invalid marks");
  const percent = (marks / exam.maxMarks) * 100;
  const grade = percent >= 90 ? "A+" : percent >= 80 ? "A" : percent >= 70 ? "B" : percent >= 60 ? "C" : percent >= 50 ? "D" : "F";
  const id = randomUUID();
  await run('INSERT INTO class_results(id,institution_id,exam_id,student_id,marks,grade,status)VALUES(?,?,?,?,?,?,?) ON CONFLICT(exam_id,student_id) DO UPDATE SET marks=EXCLUDED.marks,grade=EXCLUDED.grade,status=EXCLUDED.status', [id,institutionId,examId,studentId,marks,grade,marks >= exam.passingMarks ? "Pass" : "Fail"], await ready());
  return id;
}

export type AccountTransactionInput={transactionType:"income"|"expense";category:string;amountPaise:number;transactionDate:string;description:string;paymentMethod:string;referenceNumber:string;notes:string;academicYear:string};
const accountSelect='SELECT a.id,a.transaction_type AS "transactionType",a.category,a.amount_paise AS "amountPaise",a.transaction_date AS "transactionDate",a.description,a.payment_method AS "paymentMethod",a.reference_number AS "referenceNumber",a.source_type AS "sourceType",a.source_id AS "sourceId",a.status,a.notes,a.created_by AS "createdBy",u.name AS "createdByName",a.created_at::text AS "createdAt",a.updated_at::text AS "updatedAt" FROM account_transactions a JOIN users u ON u.id=a.created_by';

export async function listAccountTransactions(institutionId:string,filters:{academicYear:string;search?:string;type?:string;category?:string;method?:string;from?:string;to?:string;limit?:number;offset?:number}){
 const where=["a.institution_id=?","a.academic_year=?"],args:unknown[]=[institutionId,filters.academicYear];
 if(filters.search){where.push("(a.description ILIKE ? OR a.reference_number ILIKE ? OR a.category ILIKE ?)");const q=`%${filters.search}%`;args.push(q,q,q)}
 if(filters.type){where.push("a.transaction_type=?");args.push(filters.type)}if(filters.category){where.push("a.category=?");args.push(filters.category)}if(filters.method){where.push("a.payment_method=?");args.push(filters.method)}if(filters.from){where.push("a.transaction_date>=?");args.push(filters.from)}if(filters.to){where.push("a.transaction_date<=?");args.push(filters.to)}
 const db=await ready(),total=(await row<{count:number}>(`SELECT COUNT(*)::int count FROM account_transactions a WHERE ${where.join(" AND ")}`,args,db)).count,limit=Math.min(filters.limit??25,10000),offset=Math.max(filters.offset??0,0);
 const items=await rows(`${accountSelect} WHERE ${where.join(" AND ")} ORDER BY a.transaction_date DESC,a.created_at DESC LIMIT ? OFFSET ?`,[...args,limit,offset],db);
 return{items,total,limit,offset};
}

export async function createAccountTransaction(institutionId:string,userId:string,input:AccountTransactionInput){
 const id=randomUUID(),db=await ready();await run('INSERT INTO account_transactions(id,institution_id,academic_year,transaction_type,category,amount_paise,transaction_date,description,payment_method,reference_number,notes,created_by)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[id,institutionId,input.academicYear,input.transactionType,input.category,input.amountPaise,input.transactionDate,input.description,input.paymentMethod,input.referenceNumber,input.notes,userId],db);await audit(institutionId,userId,"Account Transaction Created","AccountTransaction",id,input,db);return await row(`${accountSelect} WHERE a.id=? AND a.institution_id=?`,[id,institutionId],db);
}

export async function updateAccountTransaction(institutionId:string,userId:string,id:string,input:AccountTransactionInput){
 const db=await ready(),previous=await row<Record<string,unknown>>(`${accountSelect} WHERE a.id=? AND a.institution_id=?`,[id,institutionId],db);if(!previous)throw new Error("Transaction not found");if(previous.sourceType!=="cash_book")throw new Error("Imported ledger entries cannot be edited");if(previous.status==="Voided")throw new Error("Voided transactions cannot be edited");await run('UPDATE account_transactions SET academic_year=?,transaction_type=?,category=?,amount_paise=?,transaction_date=?,description=?,payment_method=?,reference_number=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND institution_id=?',[input.academicYear,input.transactionType,input.category,input.amountPaise,input.transactionDate,input.description,input.paymentMethod,input.referenceNumber,input.notes,id,institutionId],db);await audit(institutionId,userId,"Account Transaction Updated","AccountTransaction",id,{previous,next:input},db);return await row(`${accountSelect} WHERE a.id=? AND a.institution_id=?`,[id,institutionId],db);
}

export async function voidAccountTransaction(institutionId:string,userId:string,id:string){
 const db=await ready(),previous=await row<Record<string,unknown>>(`${accountSelect} WHERE a.id=? AND a.institution_id=?`,[id,institutionId],db);if(!previous)throw new Error("Transaction not found");if(previous.status==="Voided")return previous;await run("UPDATE account_transactions SET status='Voided',updated_at=CURRENT_TIMESTAMP WHERE id=? AND institution_id=?",[id,institutionId],db);await audit(institutionId,userId,"Account Transaction Voided","AccountTransaction",id,{previous},db);return{...previous,status:"Voided"};
}

function academicMonths(academicYear:string){const start=Number(academicYear.match(/\d{4}/)?.[0]||new Date().getFullYear());return Array.from({length:12},(_,i)=>{const date=new Date(Date.UTC(start,i+3,1));return{key:date.toISOString().slice(0,7),label:new Intl.DateTimeFormat("en-IN",{month:"short",year:"numeric",timeZone:"UTC"}).format(date)}})}
export async function accountsSummary(institutionId:string,academicYear:string){
 const db=await ready(),[fees,feePayments,ledger]=await Promise.all([
  row<{total:number}>('SELECT COALESCE(SUM(final_amount),0) total FROM fees WHERE institution_id=? AND academic_year=?',[institutionId,academicYear],db),
  row<{total:number}>('SELECT COALESCE(SUM(p.amount),0) total FROM payments p JOIN fees f ON f.id=p.fee_id WHERE p.institution_id=? AND f.academic_year=? AND p.status=\'Success\'',[institutionId,academicYear],db),
  rows<{transactionType:string;category:string;amountPaise:number;transactionDate:string}>('SELECT transaction_type AS "transactionType",category,amount_paise AS "amountPaise",transaction_date AS "transactionDate" FROM account_transactions WHERE institution_id=? AND academic_year=? AND status=\'Active\'',[institutionId,academicYear],db)
 ]);
 const paise=(value:number)=>Math.round(Number(value||0)*100),feeExpected=paise(fees.total),feeCollections=paise(feePayments.total),active=ledger.map(x=>({...x,amountPaise:Number(x.amountPaise)}));
 const salary=active.filter(x=>x.transactionType==="expense"&&x.category==="Staff Salaries").reduce((n,x)=>n+x.amountPaise,0),otherIncome=active.filter(x=>x.transactionType==="income"&&x.category==="Other Income").reduce((n,x)=>n+x.amountPaise,0),cashIncome=active.filter(x=>x.transactionType==="income"&&x.category!=="Other Income").reduce((n,x)=>n+x.amountPaise,0),otherExpenses=active.filter(x=>x.transactionType==="expense"&&x.category==="Other Expenses").reduce((n,x)=>n+x.amountPaise,0),cashExpenses=active.filter(x=>x.transactionType==="expense"&&!['Staff Salaries','Other Expenses'].includes(x.category)).reduce((n,x)=>n+x.amountPaise,0),totalIncome=feeCollections+cashIncome+otherIncome,totalExpenses=salary+cashExpenses+otherExpenses;
 const monthly=academicMonths(academicYear).map(month=>{const entries=active.filter(x=>x.transactionDate.startsWith(month.key)),fee=0;return{...month,feeCollections:fee,staffSalaries:entries.filter(x=>x.transactionType==="expense"&&x.category==="Staff Salaries").reduce((n,x)=>n+x.amountPaise,0),otherIncome:entries.filter(x=>x.transactionType==="income").reduce((n,x)=>n+x.amountPaise,0),otherExpenses:entries.filter(x=>x.transactionType==="expense"&&x.category!=="Staff Salaries").reduce((n,x)=>n+x.amountPaise,0)}});
 const paymentMonths=await rows<{month:string;amount:number}>('SELECT SUBSTRING(p.payment_date,1,7) AS "month",COALESCE(SUM(p.amount),0) amount FROM payments p JOIN fees f ON f.id=p.fee_id WHERE p.institution_id=? AND f.academic_year=? AND p.status=\'Success\' GROUP BY SUBSTRING(p.payment_date,1,7)',[institutionId,academicYear],db);for(const item of monthly){item.feeCollections=paise(paymentMonths.find(p=>p.month===item.key)?.amount||0)}
 return{academicYear,feeExpected,totalCollected:feeCollections,totalExpenses,netProfitLoss:totalIncome-totalExpenses,totalIncome,totalExpenditure:totalExpenses,incomeStreams:{feeCollections,cashBookIncome:cashIncome,otherIncome,grandTotal:totalIncome},expenditureStreams:{staffSalaries:salary,cashBookExpenses:cashExpenses,otherExpenses,grandTotal:totalExpenses},monthly:monthly.map(x=>({...x,income:x.feeCollections+x.otherIncome,expenses:x.staffSalaries+x.otherExpenses,net:x.feeCollections+x.otherIncome-x.staffSalaries-x.otherExpenses}))};
}

export type SalaryInput={employeeKey:string;month:number;year:number;basicPaise:number;allowancesPaise:number;bonusPaise:number;overtimePaise:number;otherEarningsPaise:number;deductionsPaise:number;advanceDeductionPaise:number;otherDeductionsPaise:number;notes:string};
export async function adminSalaryEmployees(){const db=await ready();return rows<{key:string;teacherId:string|null;userId:string|null;name:string;employeeId:string;role:string;department:string;designation:string;institutionId:string;school:string;joiningDate:string;defaultSalaryPaise:number}>(`SELECT 'teacher:'||t.id AS key,t.id AS "teacherId",NULL AS "userId",t.name,t.employee_id AS "employeeId",'Teacher' AS role,t.department,t.subject AS designation,t.institution_id AS "institutionId",i.name AS school,t.joining_date AS "joiningDate",CAST(ROUND(t.salary*100) AS INTEGER) AS "defaultSalaryPaise" FROM teachers t JOIN institutions i ON i.id=t.institution_id WHERE t.status='Active' UNION ALL SELECT 'user:'||u.id,NULL,u.id,u.name,u.id,'Staff','',u.role,u.institution_id,i.name,'',0 FROM users u JOIN institutions i ON i.id=u.institution_id WHERE u.role='STAFF' AND COALESCE(u.status,'Active')='Active' ORDER BY 4`,[],db)}
export async function adminSalaryData(filters:{search?:string;status?:string;month?:number;year?:number;school?:string;limit?:number;offset?:number}={}){const db=await ready(),where:string[]=["1=1"],args:unknown[]=[];if(filters.search){where.push('(s.employee_name ILIKE ? OR s.employee_number ILIKE ? OR s.payslip_number ILIKE ?)');args.push(`%${filters.search}%`,`%${filters.search}%`,`%${filters.search}%`)}if(filters.status){where.push('s.payment_status=?');args.push(filters.status)}if(filters.month){where.push('s.salary_month=?');args.push(filters.month)}if(filters.year){where.push('s.salary_year=?');args.push(filters.year)}if(filters.school){where.push('s.institution_id=?');args.push(filters.school)}const clause=where.join(' AND '),total=await row<{count:number}>(`SELECT COUNT(*)::int count FROM salaries s WHERE ${clause}`,args,db),items=await rows<Record<string,unknown>>(`SELECT s.id,s.institution_id AS "institutionId",i.name AS school,s.employee_key AS "employeeKey",s.employee_name AS "employeeName",s.employee_number AS "employeeId",s.employee_role AS role,s.department,s.designation,s.salary_month AS month,s.salary_year AS year,s.basic_paise AS "basicPaise",s.allowances_paise AS "allowancesPaise",s.bonus_paise AS "bonusPaise",s.overtime_paise AS "overtimePaise",s.other_earnings_paise AS "otherEarningsPaise",s.gross_paise AS "grossPaise",s.deductions_paise AS "deductionsPaise",s.advance_deduction_paise AS "advanceDeductionPaise",s.other_deductions_paise AS "otherDeductionsPaise",s.total_deductions_paise AS "totalDeductionsPaise",s.net_paise AS "netPaise",s.paid_paise AS "paidPaise",s.payment_status AS "paymentStatus",s.payment_date AS "paymentDate",s.payment_method AS "paymentMethod",s.payment_reference AS "paymentReference",s.payment_notes AS "paymentNotes",s.notes,s.payslip_number AS "payslipNumber",s.created_at::text AS "createdAt" FROM salaries s JOIN institutions i ON i.id=s.institution_id WHERE ${clause} ORDER BY s.salary_year DESC,s.salary_month DESC,s.created_at DESC LIMIT ? OFFSET ?`,[...args,Math.min(filters.limit||25,100),filters.offset||0],db),now=new Date(),currentMonth=now.getMonth()+1,currentYear=now.getFullYear(),summary=await row<Record<string,number>>(`SELECT COUNT(*)::int records,COALESCE(SUM(net_paise),0)::int "totalSalary",COALESCE(SUM(CASE WHEN payment_status='Paid' THEN paid_paise ELSE 0 END),0)::int paid,COALESCE(SUM(CASE WHEN payment_status NOT IN ('Paid','Cancelled') THEN net_paise-paid_paise ELSE 0 END),0)::int pending,COALESCE(SUM(CASE WHEN salary_month=? AND salary_year=? THEN net_paise ELSE 0 END),0)::int "currentMonth",COALESCE(SUM(CASE WHEN salary_year=? THEN net_paise ELSE 0 END),0)::int "thisYear" FROM salaries`,[currentMonth,currentYear,currentYear],db),employees=await adminSalaryEmployees();return{items,total:total.count,summary:{...summary,teachers:employees.filter(x=>x.role==='Teacher').length,staff:employees.filter(x=>x.role==='Staff').length,employees:employees.length},employees}}
export async function createAdminSalary(adminId:string,input:SalaryInput){const db=await ready(),employees=await adminSalaryEmployees(),employee=employees.find(x=>x.key===input.employeeKey);if(!employee)throw new Error('Employee not found.');const gross=input.basicPaise+input.allowancesPaise+input.bonusPaise+input.overtimePaise+input.otherEarningsPaise,totalDeductions=input.deductionsPaise+input.advanceDeductionPaise+input.otherDeductionsPaise,net=gross-totalDeductions;if(net<0)throw new Error('Deductions cannot exceed gross salary.');return db.begin(async tx=>{const id=randomUUID(),payslip=`PAY-${input.year}-${String(input.month).padStart(2,'0')}-${id.slice(0,8).toUpperCase()}`;await run('INSERT INTO salaries(id,institution_id,employee_key,teacher_id,user_id,employee_name,employee_number,employee_role,department,designation,salary_month,salary_year,basic_paise,allowances_paise,bonus_paise,overtime_paise,other_earnings_paise,gross_paise,deductions_paise,advance_deduction_paise,other_deductions_paise,total_deductions_paise,net_paise,payslip_number,notes,created_by)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,employee.institutionId,employee.key,employee.teacherId,employee.userId,employee.name,employee.employeeId,employee.role,employee.department,employee.designation,input.month,input.year,input.basicPaise,input.allowancesPaise,input.bonusPaise,input.overtimePaise,input.otherEarningsPaise,gross,input.deductionsPaise,input.advanceDeductionPaise,input.otherDeductionsPaise,totalDeductions,net,payslip,input.notes,adminId],tx);await audit(employee.institutionId,adminId,'Salary Added','Salary',id,{employee:employee.name,month:input.month,year:input.year,netPaise:net},tx);return{id,payslipNumber:payslip}})}
export async function updateAdminSalaryPayment(adminId:string,id:string,input:{status:string;paidPaise:number;paymentDate:string;paymentMethod:string;paymentReference:string;paymentNotes:string}){const db=await ready(),salary=await row<{institutionId:string;netPaise:number}>(`SELECT institution_id AS "institutionId",net_paise AS "netPaise" FROM salaries WHERE id=?`,[id],db);if(!salary)throw new Error('Salary record not found.');if(input.paidPaise<0||input.paidPaise>salary.netPaise)throw new Error('Paid amount is invalid.');if(input.status==='Paid'&&input.paidPaise!==salary.netPaise)throw new Error('Paid amount must equal net salary.');await db.begin(async tx=>{await run('UPDATE salaries SET payment_status=?,paid_paise=?,payment_date=?,payment_method=?,payment_reference=?,payment_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[input.status,input.paidPaise,input.paymentDate||null,input.paymentMethod,input.paymentReference,input.paymentNotes,id],tx);await audit(salary.institutionId,adminId,'Salary Payment Updated','Salary',id,{status:input.status,paidPaise:input.paidPaise,reference:input.paymentReference},tx)});return true}
export async function cancelAdminSalary(adminId:string,id:string){const db=await ready(),salary=await row<{institutionId:string;paymentStatus:string}>(`SELECT institution_id AS "institutionId",payment_status AS "paymentStatus" FROM salaries WHERE id=?`,[id],db);if(!salary)throw new Error('Salary record not found.');if(salary.paymentStatus==='Paid')throw new Error('Paid salary records cannot be cancelled.');await run("UPDATE salaries SET payment_status='Cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?",[id],db);await audit(salary.institutionId,adminId,'Salary Cancelled','Salary',id,{},db)}
export async function getAdminSalary(id:string){return row<Record<string,unknown>>(`SELECT s.*,i.name AS school,st.school_address AS address,st.school_phone AS phone,st.school_email AS email,st.payslip_title AS "payslipTitle",st.payslip_subheader AS "payslipSubheader",st.footer_text AS footer,st.signature_label AS "signatureLabel" FROM salaries s JOIN institutions i ON i.id=s.institution_id LEFT JOIN settings st ON st.institution_id=s.institution_id WHERE s.id=?`,[id],await ready())}

export type AdminRange={from?:string;to?:string;search?:string;status?:string;school?:string;limit?:number;offset?:number};
const n=(value:unknown)=>Number(value||0);
export async function adminOverview(range:AdminRange={}){
 const db=await ready(),today=new Date().toISOString().slice(0,10),month=today.slice(0,7),year=today.slice(0,4),from=range.from||"0000-01-01",to=range.to||"9999-12-31";
 const [users,students,teachers,parents,staff,schools,subs,feeRevenue,subscriptionRevenue,paymentStates,outstanding,growth,revenueTrend,recent]=await Promise.all([
  row<Record<string,number>>("SELECT COUNT(*)::int total,COALESCE(SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END),0)::int active,COALESCE(SUM(CASE WHEN status='Inactive' THEN 1 ELSE 0 END),0)::int inactive,COALESCE(SUM(CASE WHEN status='Suspended' THEN 1 ELSE 0 END),0)::int suspended,COALESCE(SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END),0)::int pending,COALESCE(SUM(CASE WHEN SUBSTRING(created_at::text,1,10)=? THEN 1 ELSE 0 END),0)::int today,COALESCE(SUM(CASE WHEN SUBSTRING(created_at::text,1,7)=? THEN 1 ELSE 0 END),0)::int month FROM users WHERE role<>'SUPER_ADMIN'",[today,month],db),
  row<{count:number}>("SELECT COUNT(*)::int count FROM students",[],db),row<{count:number}>("SELECT COUNT(*)::int count FROM teachers",[],db),
  row<{count:number}>("SELECT COUNT(DISTINCT CASE WHEN parent_email<>'' THEN parent_email ELSE parent_phone END)::int count FROM students WHERE parent_email<>'' OR parent_phone<>''",[],db),
  row<{count:number}>("SELECT COUNT(*)::int count FROM users WHERE role IN ('STAFF','ACCOUNTANT','LIBRARIAN')",[],db),
  row<Record<string,number>>("SELECT COUNT(*)::int total,COALESCE(SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END),0)::int active,COALESCE(SUM(CASE WHEN status='Inactive' THEN 1 ELSE 0 END),0)::int inactive,COALESCE(SUM(CASE WHEN status='Suspended' THEN 1 ELSE 0 END),0)::int suspended,COALESCE(SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END),0)::int pending,COALESCE(SUM(CASE WHEN SUBSTRING(created_at::text,1,7)=? THEN 1 ELSE 0 END),0)::int month FROM institutions i WHERE NOT EXISTS(SELECT 1 FROM users owner WHERE owner.institution_id=i.id AND owner.role='SUPER_ADMIN')",[month],db),
  row<Record<string,number>>("SELECT COALESCE(SUM(CASE WHEN status='ACTIVE' AND expiry_date>CURRENT_TIMESTAMP THEN 1 ELSE 0 END),0)::int paid,COALESCE(SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END),0)::int trial,COALESCE(SUM(CASE WHEN status='EXPIRED' OR expiry_date<=CURRENT_TIMESTAMP THEN 1 ELSE 0 END),0)::int expired FROM subscriptions",[],db),
  row<{total:number}>("SELECT COALESCE(SUM(amount),0) total FROM payments WHERE status='Success' AND payment_date>=? AND payment_date<=?",[from,to],db),
  row<{total:number}>("SELECT COALESCE(SUM(amount),0) total FROM subscription_payments WHERE status='SUCCESS' AND payment_date>=? AND payment_date<=?",[from,to],db),
  row<Record<string,number>>("SELECT COALESCE(SUM(CASE WHEN status='Success' THEN 1 ELSE 0 END),0)::int success,COALESCE(SUM(CASE WHEN status='Pending' THEN 1 ELSE 0 END),0)::int pending,COALESCE(SUM(CASE WHEN status='Failed' THEN 1 ELSE 0 END),0)::int failed,COALESCE(SUM(CASE WHEN status='Refunded' THEN 1 ELSE 0 END),0)::int refunded,COALESCE(SUM(CASE WHEN status='Refunded' THEN amount ELSE 0 END),0) AS \"refundedAmount\" FROM payments",[],db),
  row<{total:number}>("SELECT COALESCE(SUM(pending_amount),0) total FROM fees WHERE status IN ('Pending','Partial','Overdue')",[],db),
  rows<{period:string;users:number;schools:number}>("SELECT SUBSTRING(created_at::text,1,7) period,COUNT(*)::int users,COUNT(DISTINCT institution_id)::int schools FROM users WHERE role<>'SUPER_ADMIN' GROUP BY SUBSTRING(created_at::text,1,7) ORDER BY period DESC LIMIT 12",[],db),
  rows<{period:string;amount:number}>("SELECT period,SUM(amount) amount FROM (SELECT SUBSTRING(payment_date,1,7) period,amount FROM payments WHERE status='Success' UNION ALL SELECT SUBSTRING(payment_date,1,7),amount FROM subscription_payments WHERE status='SUCCESS') x GROUP BY period ORDER BY period DESC LIMIT 12",[],db),
  rows<Record<string,unknown>>("SELECT a.id,a.action,a.entity,a.entity_id AS \"entityId\",a.created_at::text AS \"createdAt\",u.name AS \"userName\",i.name AS \"schoolName\" FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN institutions i ON i.id=a.institution_id ORDER BY a.created_at DESC LIMIT 12",[],db)
 ]);
 const weekStart=new Date(Date.now()-6*864e5).toISOString().slice(0,10),periodRevenue=await row<Record<string,number>>("SELECT COALESCE(SUM(CASE WHEN payment_date=? THEN amount ELSE 0 END),0) today,COALESCE(SUM(CASE WHEN payment_date>=? THEN amount ELSE 0 END),0) week,COALESCE(SUM(CASE WHEN SUBSTRING(payment_date,1,7)=? THEN amount ELSE 0 END),0) month,COALESCE(SUM(CASE WHEN SUBSTRING(payment_date,1,4)=? THEN amount ELSE 0 END),0) year FROM (SELECT payment_date,amount FROM payments WHERE status='Success' UNION ALL SELECT payment_date,amount FROM subscription_payments WHERE status='SUCCESS') verified",[today,weekStart,month,year],db),totalRevenue=n(feeRevenue.total)+n(subscriptionRevenue.total),refundedAmount=n(paymentStates.refundedAmount),totalProfit=totalRevenue-refundedAmount,paymentAttempts=n(paymentStates.success)+n(paymentStates.pending)+n(paymentStates.failed)+n(paymentStates.refunded),schoolCount=n(schools.total);
 return{generatedAt:new Date().toISOString(),range:{from:range.from||null,to:range.to||null},users:{...users,students:students.count,teachers:teachers.count,parents:parents.count,staff:staff.count},schools:{...schools,paid:subs.paid,trial:subs.trial},subscriptions:subs,finance:{totalRevenue,totalProfit,refundedAmount,feeRevenue:n(feeRevenue.total),subscriptionRevenue:n(subscriptionRevenue.total),outstanding:n(outstanding.total),successful:paymentStates.success,pending:paymentStates.pending,failed:paymentStates.failed,refunded:paymentStates.refunded,paymentSuccessRate:paymentAttempts?Math.round(n(paymentStates.success)/paymentAttempts*1000)/10:0,averageRevenuePerSchool:schoolCount?Math.round(totalRevenue/schoolCount):0,subscriptionRate:schoolCount?Math.round(n(subs.paid)/schoolCount*1000)/10:0,todayRevenue:n(periodRevenue.today),weekRevenue:n(periodRevenue.week),monthRevenue:n(periodRevenue.month),yearRevenue:n(periodRevenue.year)},growth:growth.reverse(),revenueTrend:revenueTrend.reverse(),recent};
}

export async function adminUsers(filters:AdminRange={}){const db=await ready(),where=["1=1"],args:unknown[]=[];if(filters.search){where.push("(u.name ILIKE ? OR u.email ILIKE ? OR i.name ILIKE ?)");const q=`%${filters.search}%`;args.push(q,q,q)}if(filters.status){where.push("u.status=?");args.push(filters.status)}if(filters.school){where.push("u.institution_id=?");args.push(filters.school)}const limit=Math.min(filters.limit||50,100),offset=Math.max(filters.offset||0,0);const total=(await row<{count:number}>(`SELECT COUNT(*)::int count FROM users u JOIN institutions i ON i.id=u.institution_id WHERE ${where.join(" AND ")}`,args,db)).count,items=await rows(`SELECT u.id,u.name,u.email,u.role,u.status,u.created_at::text AS \"createdAt\",u.last_login_at::text AS \"lastLogin\",i.id AS \"schoolId\",i.name AS \"schoolName\",COALESCE(sp.name,'No plan') AS \"planName\",COALESCE(s.status,'NONE') AS \"paymentStatus\" FROM users u JOIN institutions i ON i.id=u.institution_id LEFT JOIN subscriptions s ON s.id=(SELECT s2.id FROM subscriptions s2 WHERE s2.institution_id=i.id ORDER BY s2.created_at DESC LIMIT 1) LEFT JOIN subscription_plans sp ON sp.id=s.plan_id WHERE ${where.join(" AND ")} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,[...args,limit,offset],db);return{items,total,limit,offset}}
export async function adminSchools(filters:AdminRange={}){const db=await ready(),where=["1=1"],args:unknown[]=[];if(filters.search){where.push("(i.name ILIKE ? OR COALESCE(a.email,'') ILIKE ?)");const q=`%${filters.search}%`;args.push(q,q)}if(filters.status){where.push("i.status=?");args.push(filters.status)}const limit=Math.min(filters.limit||50,100),offset=Math.max(filters.offset||0,0);const total=(await row<{count:number}>(`SELECT COUNT(*)::int count FROM institutions i LEFT JOIN users a ON a.id=(SELECT u.id FROM users u WHERE u.institution_id=i.id AND u.role IN ('SCHOOL_ADMIN','SUPER_ADMIN') ORDER BY u.created_at LIMIT 1) WHERE ${where.join(" AND ")}`,args,db)).count,items=await rows(`SELECT i.id,i.name,i.status,i.created_at::text AS \"createdAt\",a.name AS \"adminName\",a.email,(SELECT COUNT(*) FROM students st WHERE st.institution_id=i.id)::int AS students,(SELECT COUNT(*) FROM teachers t WHERE t.institution_id=i.id)::int AS teachers,COALESCE(sp.name,'No plan') AS \"planName\",COALESCE(s.status,'NONE') AS \"subscriptionStatus\",COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.institution_id=i.id AND p.status='Success'),0)+COALESCE((SELECT SUM(x.amount) FROM subscription_payments x WHERE x.institution_id=i.id AND x.status='SUCCESS'),0) AS revenue FROM institutions i LEFT JOIN users a ON a.id=(SELECT u.id FROM users u WHERE u.institution_id=i.id AND u.role IN ('SCHOOL_ADMIN','SUPER_ADMIN') ORDER BY u.created_at LIMIT 1) LEFT JOIN subscriptions s ON s.id=(SELECT s2.id FROM subscriptions s2 WHERE s2.institution_id=i.id ORDER BY s2.created_at DESC LIMIT 1) LEFT JOIN subscription_plans sp ON sp.id=s.plan_id WHERE ${where.join(" AND ")} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,[...args,limit,offset],db);return{items,total,limit,offset}}
export async function adminTransactions(filters:AdminRange={}){const db=await ready(),where=["1=1"],args:unknown[]=[];if(filters.search){where.push("(p.receipt_number ILIKE ? OR p.transaction_id ILIKE ? OR st.name ILIKE ? OR i.name ILIKE ?)");const q=`%${filters.search}%`;args.push(q,q,q,q)}if(filters.status){where.push("p.status=?");args.push(filters.status)}if(filters.school){where.push("p.institution_id=?");args.push(filters.school)}if(filters.from){where.push("p.payment_date>=?");args.push(filters.from)}if(filters.to){where.push("p.payment_date<=?");args.push(filters.to)}const limit=Math.min(filters.limit||50,100),offset=Math.max(filters.offset||0,0);const total=(await row<{count:number}>(`SELECT COUNT(*)::int count FROM payments p JOIN students st ON st.id=p.student_id JOIN institutions i ON i.id=p.institution_id WHERE ${where.join(" AND ")}`,args,db)).count,items=await rows(`SELECT p.id,p.receipt_number AS \"receiptNumber\",p.transaction_id AS \"transactionId\",st.name AS \"studentName\",i.id AS \"schoolId\",i.name AS \"schoolName\",p.amount,p.payment_method AS \"method\",p.status,p.payment_date AS \"paymentDate\" FROM payments p JOIN students st ON st.id=p.student_id JOIN institutions i ON i.id=p.institution_id WHERE ${where.join(" AND ")} ORDER BY p.payment_date DESC,p.created_at DESC LIMIT ? OFFSET ?`,[...args,limit,offset],db);return{items,total,limit,offset}}
export async function adminSubscriptions(){return rows(`SELECT s.id,i.name AS \"schoolName\",sp.name AS \"planName\",s.student_capacity AS \"studentCapacity\",s.amount_paid AS \"amountPaid\",s.status,s.activation_date::text AS \"activationDate\",s.expiry_date::text AS \"expiryDate\",s.created_at::text AS \"createdAt\" FROM subscriptions s JOIN institutions i ON i.id=s.institution_id JOIN subscription_plans sp ON sp.id=s.plan_id ORDER BY s.created_at DESC`,[],await ready())}
export async function adminManageSubscription(adminId:string,id:string,action:"extend"|"cancel"|"suspend",days=0){const db=await ready(),item=await row<{institutionId:string;expiryDate:string|null}>(`SELECT institution_id AS "institutionId",expiry_date::text AS "expiryDate" FROM subscriptions WHERE id=?`,[id],db);if(!item)throw new Error("Subscription not found");if(action==="extend"){if(!Number.isInteger(days)||days<1||days>730)throw new Error("Extension must be between 1 and 730 days");const base=item.expiryDate&&new Date(item.expiryDate)>new Date()?new Date(item.expiryDate):new Date(),expiry=new Date(base.getTime()+days*864e5);await run("UPDATE subscriptions SET status='ACTIVE',payment_status='Paid',expiry_date=?,renewal_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[expiry,expiry,id],db)}else await run("UPDATE subscriptions SET status=?,auto_renew=FALSE,updated_at=CURRENT_TIMESTAMP WHERE id=?",[action==="cancel"?"CANCELLED":"SUSPENDED",id],db);await audit(item.institutionId,adminId,action==="extend"?"Subscription Extended":action==="cancel"?"Subscription Cancelled":"Subscription Suspended","Subscription",id,{days},db);return true}
export async function adminAuditLogs(limit=100){return rows(`SELECT a.id,a.action,a.entity,a.entity_id AS \"entityId\",a.details,a.created_at::text AS \"createdAt\",u.name AS \"userName\",u.email,i.name AS \"schoolName\" FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN institutions i ON i.id=a.institution_id ORDER BY a.created_at DESC LIMIT ?`,[Math.min(limit,500)],await ready())}
export async function adminSetUserStatus(adminId:string,id:string,status:"Active"|"Inactive"|"Suspended"){if(adminId===id)throw new Error("The private admin account cannot be disabled");const db=await ready(),target=await row<{institutionId:string}>("SELECT institution_id AS \"institutionId\" FROM users WHERE id=?",[id],db);if(!target)throw new Error("User not found");await run("UPDATE users SET status=? WHERE id=?",[status,id],db);await audit(target.institutionId,adminId,`User ${status}`,"User",id,{status},db)}
export async function adminSetSchoolStatus(adminId:string,id:string,status:"Active"|"Inactive"|"Suspended"){const db=await ready(),target=await row<{id:string}>("SELECT id FROM institutions WHERE id=?",[id],db);if(!target)throw new Error("School not found");await run("UPDATE institutions SET status=? WHERE id=?",[status,id],db);await audit(id,adminId,`School ${status}`,"Institution",id,{status},db)}
export async function getAdminSettings(){const db=await ready();await run("INSERT INTO admin_settings(id)VALUES('global') ON CONFLICT(id) DO NOTHING",[],db);return row<Record<string,unknown>>('SELECT application_name AS "applicationName",support_email AS "supportEmail",currency,timezone,date_format AS "dateFormat",session_timeout_minutes AS "sessionTimeoutMinutes",subscription_warning_days AS "subscriptionWarningDays",subscription_notifications_enabled AS "subscriptionNotificationsEnabled",in_app_notifications_enabled AS "inAppNotificationsEnabled",email_notifications_enabled AS "emailNotificationsEnabled",subscription_grace_days AS "subscriptionGraceDays",updated_at::text AS "updatedAt" FROM admin_settings WHERE id=\'global\'',[],db)}
export async function saveAdminSettings(adminId:string,input:{applicationName:string;supportEmail:string;currency:string;timezone:string;dateFormat:string;sessionTimeoutMinutes:number;subscriptionWarningDays:string;subscriptionNotificationsEnabled:boolean;inAppNotificationsEnabled:boolean;emailNotificationsEnabled:boolean;subscriptionGraceDays:number}){const db=await ready();await run("INSERT INTO admin_settings(id,application_name,support_email,currency,timezone,date_format,session_timeout_minutes,subscription_warning_days,subscription_notifications_enabled,in_app_notifications_enabled,email_notifications_enabled,subscription_grace_days,updated_by)VALUES('global',?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET application_name=EXCLUDED.application_name,support_email=EXCLUDED.support_email,currency=EXCLUDED.currency,timezone=EXCLUDED.timezone,date_format=EXCLUDED.date_format,session_timeout_minutes=EXCLUDED.session_timeout_minutes,subscription_warning_days=EXCLUDED.subscription_warning_days,subscription_notifications_enabled=EXCLUDED.subscription_notifications_enabled,in_app_notifications_enabled=EXCLUDED.in_app_notifications_enabled,email_notifications_enabled=EXCLUDED.email_notifications_enabled,subscription_grace_days=EXCLUDED.subscription_grace_days,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP",[input.applicationName,input.supportEmail,input.currency,input.timezone,input.dateFormat,input.sessionTimeoutMinutes,input.subscriptionWarningDays,input.subscriptionNotificationsEnabled,input.inAppNotificationsEnabled,input.emailNotificationsEnabled,input.subscriptionGraceDays,adminId],db);const admin=await row<{institutionId:string}>("SELECT institution_id AS \"institutionId\" FROM users WHERE id=?",[adminId],db);if(admin)await audit(admin.institutionId,adminId,"Admin Settings Updated","AdminSettings","global",{subscriptionWarningDays:input.subscriptionWarningDays,subscriptionNotificationsEnabled:input.subscriptionNotificationsEnabled},db);return getAdminSettings()}
