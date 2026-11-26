/** Public readiness metadata only. Never return credential values to a client. */
export function conversationConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const provider = env.AI_PROVIDER ?? "none";
  const native = env.AGUS_AGENT_ARCHITECTURE === "native-gemini";
  const configured =
    !!env.AI_API_KEY?.trim() &&
    (native ? provider === "gemini" : ["gemini", "openai"].includes(provider));
  return {
    configured,
    provider,
    model:
      env.AI_MODEL ||
      (native
        ? "gemini-3.5-flash-lite"
        : provider === "openai"
          ? "gpt-4.1-mini"
          : "gemini-2.5-flash"),
    architecture: native ? "native-gemini" : "financial-agent",
    unavailableReason: configured
      ? null
      : !env.AI_API_KEY?.trim()
        ? "MODEL_CREDENTIAL_MISSING"
        : native && provider !== "gemini"
          ? "NATIVE_GEMINI_PROVIDER_REQUIRED"
          : "MODEL_PROVIDER_MISSING",
  };
}

/** SDK 0.12 accepts apiKey:string. The dashboard's pub_testnet_ keys are public;
 * pk_ remains compatible with existing publishable keys. Key shape never proves
 * network or spending authority: getAppConfig/XDR verification remain required. */
export function isPollarPublishableKey(key: string): boolean {
  return key.length <= 512 && /^(?:pub_testnet_|pk_)[A-Za-z0-9_-]+$/.test(key);
}
