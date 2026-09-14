import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { PrintButton } from "@/components/print-button";
import { getInstitution, getReceipt, getSchoolAsset } from "@/lib/db";
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
  const school = await getInstitution(user.institutionId),[logo,signature]=await Promise.all([getSchoolAsset(user.institutionId,"logo"),getSchoolAsset(user.institutionId,"signature")]);
  return <div className="mx-auto max-w-[900px]">
    <div className="mb-5 flex flex-wrap justify-between gap-3 print:hidden">
      <Link href="/dashboard/payment-history" className="btn-secondary">Back to payment history</Link>
      <div className="flex gap-2"><a className="btn-secondary" href={`/api/receipts/${encodeURIComponent(number)}/pdf`}><Download className="size-4"/>Download PDF</a><PrintButton/></div>
    </div>
    <article className="receipt-sheet bg-white text-[#202c40] shadow-soft print:shadow-none">
      <ReceiptCopy copy="SCHOOL COPY" payment={payment} school={school} hasLogo={Boolean(logo)} hasSignature={Boolean(signature)}/>
      <div className="receipt-cut" aria-hidden="true"><span>✂</span></div>
      <ReceiptCopy copy="CANDIDATE COPY" payment={payment} school={school} hasLogo={Boolean(logo)} hasSignature={Boolean(signature)}/>
    </article>
  </div>;
}

type ReceiptData = NonNullable<Awaited<ReturnType<typeof getReceipt>>>;
type SchoolData = Awaited<ReturnType<typeof getInstitution>>;

function ReceiptCopy({copy,payment,school,hasLogo,hasSignature}:{copy:"SCHOOL COPY"|"CANDIDATE COPY";payment:ReceiptData;school:SchoolData;hasLogo:boolean;hasSignature:boolean}) {
  const words=amountInWords(payment.amount),logo=hasLogo?"/api/settings/assets/logo":"/eduledger-logo.jpeg",signature=hasSignature?"/api/settings/assets/signature":"/authorized-signature.jpg";
  return <section className="receipt-copy">
    <header className="text-center">
      <Image src={logo} alt={`${school.name} logo`} width={54} height={50} className="mx-auto h-[50px] w-[54px] object-contain" unoptimized={Boolean(school.logoUrl)}/>
      <h1>{school.name}</h1>
      <p>{[school.address,school.diseCode&&`DISE Code: ${school.diseCode}`].filter(Boolean).join(" | ")||[school.phone,school.email].filter(Boolean).join(" | ")||"School Administration"}</p>
    </header>
    <h2>{school.feeReceiptTitle||"RECEIPT"}</h2>
    <div className="receipt-meta">
      <div><p><b>Receipt No:</b> {payment.receiptNumber}</p><p><b>Student Name:</b> {payment.studentName}</p><small>[ {copy} ]</small></div>
      <div className="text-right"><p><b>Date:</b> {receiptDate(payment.paymentDate)}</p><p><b>Class &amp; Section:</b> {payment.className}{payment.section?`-${payment.section}`:""}</p><p><b>Academic Year:</b> {payment.academicYear}</p></div>
    </div>
    <p className="receipt-sentence">Received with thanks from Mr/Ms. <b>{payment.studentName}</b>, the sum of <b>{words}</b> by <b>{payment.method}</b> towards the following fees:</p>
    <table><thead><tr><th>Particulars</th><th>Amount</th></tr></thead><tbody><tr><td>{payment.feeType}</td><td>{money(payment.amount)}</td></tr><tr className="receipt-total"><td>Total</td><td>{money(payment.amount)}</td></tr></tbody></table>
    <p className="receipt-words"><b>Amount Paid:</b> {words}</p>
    <div className="receipt-signatures">
      <div><span/><b>Cashier Signature</b></div>
      <div><Image unoptimized={hasSignature} src={signature} alt="Authorized signature" width={94} height={40} className="mx-auto h-10 w-24 object-contain"/><span/><b>{school.signatureLabel||"Authorized Signatory"}</b></div>
    </div>
  </section>;
}
