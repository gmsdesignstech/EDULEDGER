import "server-only";
import { getSubscription } from "./db";
import { capacityMessage } from "./subscription";
export async function subscriptionAccessError(institutionId: string) {
  const subscription = await getSubscription(institutionId);
  return subscription.status === "ACTIVE"
    ? null
    : {
        error:
          subscription.status === "EXPIRED"
            ? "Your subscription has expired. Renew your annual plan to continue."
            : "Activate an annual subscription to use this feature.",
        status: 402 as const,
        code: "SUBSCRIPTION_REQUIRED",
      };
}
export function explainCapacityError(error: unknown) {
  if (!(error instanceof Error)) return null;
  const match = /^CAPACITY_EXCEEDED:(\d+):(\d+):(\d+)$/.exec(error.message);
  return match
    ? capacityMessage(Number(match[1]), Number(match[2]), Number(match[3]))
    : error.message === "SUBSCRIPTION_REQUIRED"
      ? "Activate an annual subscription before adding students."
      : null;
}
