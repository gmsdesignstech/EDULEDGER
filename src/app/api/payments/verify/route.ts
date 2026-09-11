import { NextResponse } from "next/server";
import { paymentSignatureSchema } from "@/lib/validation";
import { getRazorpayPayment, verifyRazorpaySignature } from "@/lib/payment";
import {
  activateVerifiedSubscription,
  findSubscriptionByOrder,
} from "@/lib/db";
import { currentUser } from "@/lib/session";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = paymentSignatureSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid payment payload" },
      { status: 400 },
    );
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Payment service unavailable" },
      { status: 503 },
    );
  const {
      razorpay_order_id: o,
      razorpay_payment_id: p,
      razorpay_signature: s,
    } = parsed.data,
    order = await findSubscriptionByOrder(o);
  if (!order || order.institutionId !== user.institutionId)
    return NextResponse.json(
      { error: "Payment order not found" },
      { status: 404 },
    );
  if (!verifyRazorpaySignature(o, p, s, secret))
    return NextResponse.json(
      { error: "Signature verification failed" },
      { status: 401 },
    );
  try {
    const payment = await getRazorpayPayment(p);
    if (
      payment.order_id !== o ||
      payment.amount !== Math.round(order.amountPaid * 100) ||
      payment.currency !== "INR"
    )
      return NextResponse.json(
        { error: "Payment details do not match this order." },
        { status: 409 },
      );
    if (payment.status !== "captured" && !payment.captured)
      return NextResponse.json(
        {
          error:
            "Payment is verified but not captured yet. Activation will complete automatically.",
        },
        { status: 202 },
      );
    return NextResponse.json({
      verified: true,
      subscription: await activateVerifiedSubscription(o, p, s),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not confirm payment",
      },
      { status: 502 },
    );
  }
}
