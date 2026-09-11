import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { getPlan } from "@/lib/subscription-plans";
import { createRazorpayOrder } from "@/lib/payment";
import { createPendingSubscription } from "@/lib/db";
export const runtime = "nodejs";
const schema = z.object({ planId: z.string().min(1).max(30) });
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Choose a valid plan." },
      { status: 400 },
    );
  const plan = getPlan(parsed.data.planId);
  if (!plan)
    return NextResponse.json(
      { error: "This plan is unavailable." },
      { status: 400 },
    );
  try {
    const order = await createRazorpayOrder({
      amount: plan.price * 100,
      receipt: `sub_${Date.now()}`,
      notes: { institutionId: user.institutionId, planId: plan.id },
    });
    await createPendingSubscription(user.institutionId, plan.id, order.id);
    return NextResponse.json({ ...order, planName: plan.name });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not start checkout.",
      },
      { status: 503 },
    );
  }
}
