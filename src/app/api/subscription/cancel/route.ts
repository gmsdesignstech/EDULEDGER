import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { failSubscription, findSubscriptionByOrder } from "@/lib/db";
const schema = z.object({ orderId: z.string().min(1) });
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  const order = await findSubscriptionByOrder(parsed.data.orderId);
  if (!order || order.institutionId !== user.institutionId)
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  await failSubscription(parsed.data.orderId, "CANCELLED");
  return NextResponse.json({ cancelled: true });
}
