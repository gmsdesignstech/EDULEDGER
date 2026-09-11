import { NextResponse } from "next/server";
import {
  activateVerifiedSubscription as activateSubscription,
  failSubscription,
  findSubscriptionByOrder,
  recordWebhookEvent,
} from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/subscription";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const raw = await request.text(),
    signature = request.headers.get("x-razorpay-signature") || "",
    secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Webhook is not configured" },
      { status: 503 },
    );
  if (!verifyWebhookSignature(raw, signature, secret))
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 401 },
    );
  let body: {
    event?: string;
    payload?: {
      payment?: {
        entity?: { id?: string; order_id?: string; status?: string };
      };
    };
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const payment = body.payload?.payment?.entity,
    orderId = payment?.order_id,
    paymentId = payment?.id,
    event = body.event || "unknown",
    eventId =
      request.headers.get("x-razorpay-event-id") ||
      `${event}:${paymentId || orderId || "none"}`;
  if (!(await recordWebhookEvent(eventId, event)))
    return NextResponse.json({ received: true, duplicate: true });
  if (orderId && (await findSubscriptionByOrder(orderId))) {
    if ((event === "payment.captured" || event === "order.paid") && paymentId)
      await activateSubscription(orderId, paymentId, signature);
    else if (event === "payment.failed") await failSubscription(orderId, "FAILED");
  }
  return NextResponse.json({ received: true });
}
