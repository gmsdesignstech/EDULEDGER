import { NextResponse } from "next/server";
import {
  activateVerifiedSubscription,
  failSubscription,
  findSubscriptionByOrder,
  recordWebhookEvent,
} from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/subscription";
export const runtime = "nodejs";
type RazorpayEntity = { id?: string; order_id?: string; status?: string };
type Payload = {
  event?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: RazorpayEntity };
    order?: { entity?: RazorpayEntity };
  };
};
export async function POST(request: Request) {
  const body = await request.text(),
    signature = request.headers.get("x-razorpay-signature") || "",
    secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "Webhook is not configured" },
      { status: 503 },
    );
  if (!verifyWebhookSignature(body, signature, secret))
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 401 },
    );
  let event: Payload;
  try {
    event = JSON.parse(body) as Payload;
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook payload" },
      { status: 400 },
    );
  }
  const payment = event.payload?.payment?.entity,
    orderEntity = event.payload?.order?.entity,
    orderId = payment?.order_id || orderEntity?.id,
    paymentId = payment?.id;
  if (!event.event || !orderId)
    return NextResponse.json({ received: true, ignored: true });
  const eventId =
    request.headers.get("x-razorpay-event-id") ||
    `${event.event}:${paymentId || orderId}:${event.created_at || 0}`;
  if (!(await recordWebhookEvent(eventId, event.event)))
    return NextResponse.json({ received: true, duplicate: true });
  const order = await findSubscriptionByOrder(orderId);
  if (!order) return NextResponse.json({ received: true, ignored: true });
  if (
    (event.event === "payment.captured" || event.event === "order.paid") &&
    paymentId
  )
    await activateVerifiedSubscription(orderId, paymentId, `webhook:${signature}`);
  else if (event.event === "payment.failed")
    await failSubscription(orderId, "FAILED");
  return NextResponse.json({ received: true });
}
