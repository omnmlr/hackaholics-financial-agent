import { expect, it } from "vitest";
import {
  redactAgentText,
  modelData,
  privateAgentText,
  privateModelData,
} from "../src/lib/personal-agent/privacy";
it("preserves ordinary research links, exact task figures and public wallet identifiers", () => {
  const text =
    "Compare https://example.org/items?category=books with 123456789.1234 units and public address 2URn9ic3aMGQgGXzPcKMPjdwUJgj9Efumr2bTq4jWNAb";
  expect(redactAgentText(text)).toBe(text);
});
it("redacts credentials from text, URL userinfo/query/fragment and nested model context", () => {
  const value = redactAgentText(
    "Read https://user:pass@example.org/path?token=credential#auth=secret and api_key=my-private-value",
  );
  expect(value).not.toContain("user:pass");
  expect(value).not.toContain("token=credential");
  expect(value).not.toContain("my-private-value");
  expect(value).toContain("example.org/path");
  expect(
    modelData({ privateKey: "secret-value", notes: ["password=sensitive"] }),
  ).toEqual({
    privateKey: "[credential withheld]",
    notes: ["[credential withheld]"],
  });
});
it("withholds provider-secret assignments, recovery phrases and nested wallet credentials", () => {
  const redacted = redactAgentText(
    "POLLAR_SECRET_KEY=provider-secret; wallet seed=one two three four; mnemonic=synthetic phrase; sk_test_abcdefghijklmnop",
  );
  expect(redacted).not.toContain("provider-secret");
  expect(redacted).not.toContain("one two three four");
  expect(redacted).not.toContain("synthetic phrase");
  expect(redacted).not.toContain("sk_test_");
  expect(
    modelData({
      pollarSecretKey: "hidden",
      incoming_viewing_key: "hidden",
      recoveryPhrase: "hidden",
      walletSeed: "hidden",
    }),
  ).toEqual({
    pollarSecretKey: "[credential withheld]",
    incoming_viewing_key: "[credential withheld]",
    recoveryPhrase: "[credential withheld]",
    walletSeed: "[credential withheld]",
  });
});
it("minimizes private-mode addresses and raw memos even when typed in the current message", () => {
  const address = "ztestsapling1" + "q".repeat(65);
  const text = privateAgentText(
    `Send Daniel 0.2 ZEC privately to ${address}; memo: confidential-reference`,
  );
  expect(text).toContain("Daniel 0.2 ZEC");
  expect(text).not.toContain(address);
  expect(text).not.toContain("confidential-reference");
  expect(
    privateModelData({
      recipientAddress: address,
      rawMemo: "private memo",
      status: "pending",
    }),
  ).toEqual({
    recipientAddress: "[private wallet metadata withheld]",
    rawMemo: "[private wallet metadata withheld]",
    status: "pending",
  });
});
