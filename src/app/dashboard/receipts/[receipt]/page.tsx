import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { PrintButton } from "@/components/print-button";
import { getInstitution, getReceipt } from "@/lib/db";
import { amountInWords, receiptDate } from "@/lib/receipt-format";
import { requireUser } from "@/lib/session";

export const runtime = "nodejs";
const money = (value: number) =>
  `₹ ${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default async function Receipt({ params }: { params: Promise<{ receipt: string }> }) {
  const user = await requireUser();
  const number = decodeURIComponent((await params).receipt);
  const payment = await getReceipt(user.institutionId, number);
  if (!payment) notFound();
  const school = await getInstitution(user.institutionId);
  return <div className="mx-auto max-w-[900px]">
    <div className="mb-5 flex flex-wrap justify-between gap-3 print:hidden">
      <Link href="/dashboard/payment-history" className="btn-secondary">Back to payment history</Link>
      <div className="flex gap-2"><a className="btn-secondary" href={`/api/receipts/${encodeURIComponent(number)}/pdf`}><Download className="size-4"/>Download PDF</a><PrintButton/></div>
    </div>
    <article className="receipt-sheet bg-white text-[#202c40] shadow-soft print:shadow-none">
      <ReceiptCopy copy="SCHOOL COPY" payment={payment} school={school}/>
      <div className="receipt-cut" aria-hidden="true"><span>✂</span></div>
      <ReceiptCopy copy="CANDIDATE COPY" payment={payment} school={school}/>
    </article>
  </div>;
}

type ReceiptData = NonNullable<Awaited<ReturnType<typeof getReceipt>>>;
type SchoolData = Awaited<ReturnType<typeof getInstitution>>;

function ReceiptCopy({copy,payment,school}:{copy:"SCHOOL COPY"|"CANDIDATE COPY";payment:ReceiptData;school:SchoolData}) {
  const words=amountInWords(payment.amount),logo=school.logoUrl||"/eduledger-logo.jpeg";
  return <section className="receipt-copy">
    <header className="text-center">
      <Image src={logo} alt={`${school.name} logo`} width={54} height={50} className="mx-auto h-[50px] w-[54px] object-contain" unoptimized={Boolean(school.logoUrl)}/>
      <h1>{school.name}</h1>
      <p>{[school.address,school.phone&&`Phone: ${school.phone}`].filter(Boolean).join(" | ")||"School Administration"}</p>
    </header>
    <h2>FEE PAYMENT RECEIPT</h2>
    <div className="receipt-meta">
      <div><p><b>Receipt No:</b> {payment.receiptNumber}</p><p><b>Student Name:</b> {payment.studentName}</p><p><b>Admission No:</b> {payment.admission}</p><small>[ {copy} ]</small></div>
      <div className="text-right"><p><b>Date:</b> {receiptDate(payment.paymentDate)}</p><p><b>Class &amp; Section:</b> {payment.className}-{payment.section}</p>{payment.rollNumber&&<p><b>Roll No:</b> {payment.rollNumber}</p>}<p><b>Academic Year:</b> {payment.academicYear}</p></div>
    </div>
    <p className="receipt-sentence">Received with thanks from Mr/Ms. <b>{payment.studentName}</b>, the sum of <b>{words}</b> by <b>{payment.method}</b> towards the following fees:</p>
    <table><thead><tr><th>Particulars</th><th>Amount</th></tr></thead><tbody><tr><td>{payment.feeType}</td><td>{money(payment.amount)}</td></tr><tr className="receipt-total"><td>Total</td><td>{money(payment.amount)}</td></tr></tbody></table>
    <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><p><b>Payment Mode:</b> {payment.method}</p><p className="text-right"><b>Transaction ID:</b> {payment.transactionId||"Not provided"}</p></div>
    <p className="receipt-words"><b>Amount Paid:</b> {words}</p>
    <div className="receipt-signatures">
      <div><span/><b>Cashier Signature</b></div>
      <div><Image src="/authorized-signature.jpg" alt="Authorized signature" width={94} height={40} className="mx-auto h-10 w-24 object-contain"/><span/><b>Authorized Signatory</b></div>
    </div>
  </section>;
}
