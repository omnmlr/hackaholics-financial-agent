import { expect, it } from "vitest";
import { redactAgentText, modelData } from "../src/lib/personal-agent/privacy";
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
