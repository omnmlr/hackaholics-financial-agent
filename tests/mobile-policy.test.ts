import { expect, it } from "vitest";
import { parseNotificationLink } from "../apps/mobile/src/policy";
it("opens only opaque notification resource IDs and rejects approval links, token query strings and deceptive origins", () => {
  const id = "12345678-1234-4234-8234-123456789abc";
  expect(parseNotificationLink(`agus://open/payment/${id}`)).toEqual({
    resourceType: "payment",
    resourceId: id,
  });
  expect(parseNotificationLink(`agus://open/p2p/${id}`)?.resourceType).toBe(
    "p2p",
  );
  expect(parseNotificationLink(`agus://open/request/${id}`)?.resourceType).toBe(
    "request",
  );
  for (const link of [
    `agus://approve/payment/${id}`,
    `agus://open/payment/${id}?token=sensitive`,
    `https://agus/open/payment/${id}`,
    `agus://open/solana/${id}/submit`,
    `agus://open/payment/${id}#approve`,
    `agus://open/payment/not-a-uuid`,
    `agus://open/p2p/------------------------------------`,
    `agus://attacker@open/p2p/${id}`,
    `agus://open:444/request/${id}`,
  ])
    expect(parseNotificationLink(link)).toBeNull();
});
