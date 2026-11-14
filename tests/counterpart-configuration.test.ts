import { describe, it, expect } from "vitest";
import {
  conversationConfiguration,
  isPollarPublishableKey,
} from "../src/lib/web-product/runtime-configuration";

describe("Counterpart runtime boundaries", () => {
  it("accepts dashboard public testnet keys while rejecting private and mainnet keys", () => {
    expect(isPollarPublishableKey("pub_testnet_dashboard_example")).toBe(true);
    expect(isPollarPublishableKey("pk_test_legacy_example")).toBe(true);
    for (const value of [
      "",
      "sk_test_secret",
      "pub_mainnet_example",
      "pub_testnet_has space",
      "pub_testnet_",
      "private-key",
    ]) {
      expect(isPollarPublishableKey(value)).toBe(false);
    }
  });
  it("does not advertise OpenAI as a configured native Gemini agent", () => {
    const result = conversationConfiguration({
      AGUS_AGENT_ARCHITECTURE: "native-gemini",
      AI_PROVIDER: "openai",
      AI_API_KEY: "server-only-secret",
    });
    expect(result.configured).toBe(false);
    expect(result.unavailableReason).toBe("NATIVE_GEMINI_PROVIDER_REQUIRED");
    expect(JSON.stringify(result)).not.toContain("server-only-secret");
  });
  it("distinguishes missing credentials from a configured provider, without claiming a successful call", () => {
    expect(
      conversationConfiguration({ AI_PROVIDER: "gemini", AI_API_KEY: " " })
        .unavailableReason,
    ).toBe("MODEL_CREDENTIAL_MISSING");
    const result = conversationConfiguration({
      AGUS_AGENT_ARCHITECTURE: "native-gemini",
      AI_PROVIDER: "gemini",
      AI_API_KEY: "server-only-secret",
    });
    expect(result.configured).toBe(true);
    expect(result.model).toBe("gemini-3.5-flash-lite");
    expect(JSON.stringify(result)).not.toContain("server-only-secret");
  });
});
