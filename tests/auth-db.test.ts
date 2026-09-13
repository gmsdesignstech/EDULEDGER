import { describe, expect, it } from "vitest";
import { compare, hash } from "bcryptjs";
import { createHmac } from "node:crypto";
import {
  activateVerifiedSubscription,
  createAccount,
  createPendingSubscription,
  createSession,
  deleteSession,
  findUserByEmail,
  getSubscription,
  getUserBySession,
} from "../src/lib/db";
import { verifyRazorpaySignature } from "../src/lib/payment";

describe("database auth flow", () => {
  it("creates a school admin account with SQLite bindings", async () => {
    const email = `sqlite-auth-${Date.now()}@example.com`;
    const passwordHash = await hash("password123", 12);
    const user = await createAccount({
      name: "SQLite Test User",
      email,
      institution: "Test Institution",
      passwordHash,
    });

    expect(user.email).toBe(email);
    expect(user.role).toBe("SCHOOL_ADMIN");
    expect(await findUserByEmail(email)).toMatchObject({ email });
    expect(await compare("password123", passwordHash)).toBe(true);
    expect(await compare("incorrect-password", passwordHash)).toBe(false);

    const session = await createSession(user.id);
    expect(await getUserBySession(session.token)).toMatchObject({ email });
    await deleteSession(session.token);
    expect(await getUserBySession(session.token)).toBeUndefined();

    const orderId = `order_test_${Date.now()}`;
    const paymentId = `pay_test_${Date.now()}`;
    const secret = "test-secret-used-only-by-the-automated-test";
    const signature = createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    expect(
      verifyRazorpaySignature(orderId, paymentId, signature, secret),
    ).toBe(true);
    expect(
      verifyRazorpaySignature(orderId, paymentId, "0".repeat(64), secret),
    ).toBe(false);

    await createPendingSubscription(user.institutionId, "starter", orderId);
    await activateVerifiedSubscription(orderId, paymentId, signature);
    expect(await getSubscription(user.institutionId)).toMatchObject({
      status: "ACTIVE",
      razorpayOrderId: orderId,
      razorpayPaymentId: paymentId,
    });
  });
});
