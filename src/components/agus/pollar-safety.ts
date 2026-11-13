/** Read the actual remote application network before any wallet or signing flow. */
export function isStellarTestnetApp(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("application" in value)) return false;
  const app = value.application;
  return !!app && typeof app === "object" && "network" in app && app.network === "testnet" &&
    "chains" in app && Array.isArray(app.chains) && app.chains.includes("STELLAR");
}
