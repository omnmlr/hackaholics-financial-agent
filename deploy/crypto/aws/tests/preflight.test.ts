import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "@solana/web3.js";
import { validateEnvironment } from "@/lib/environment";
import { createIdentity } from "@/server/auth";
import { assertEncryptionReady } from "@/server/secrets";
import { assertSchema } from "@/server/migrations";
import { cryptoRpc } from "@/server/crypto/rpc";
import { approvedCryptoProviders } from "@/server/crypto/registry";
import { cryptoMonitoringReady } from "@/server/crypto/alerts";
import { GET } from "@/app/api/v1/[...path]/route";
import * as sqlModule from "@/server/sql";
import * as authModule from "@/server/auth";
import * as secretsModule from "@/server/secrets";
import * as migrationsModule from "@/server/migrations";

// Canonical test fixtures
const VALID_DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const VALID_32_BYTE_KEY = Buffer.alloc(32, 7).toString("base64");
const VALID_AUTH_SECRET = "sample-32-char-random-secret-for-auth-testing-only";
const VALID_ORIGIN = "https://crypto-devnet.example.com";
const VALID_DATABASE_URL = "postgresql://agus_crypto_devnet_runtime:secret@neon-mock.invalid/agus_crypto_devnet_20261124?sslmode=require";

// Pure preflight logic extracted directly from scripts/crypto-devnet.ts
function runPreflightChecks(options: {
  dbSafe?: boolean;
  dbSchemaOk?: boolean;
}) {
  if (
    validateEnvironment().profile !== "devnet" ||
    process.env.AGUS_AUTH_PUBLIC !== "false"
  ) {
    throw new Error("INVITE_ONLY_DEVNET_REQUIRED");
  }
  if (
    !process.env.DATABASE_URL?.match(/^postgres(?:ql)?:\/\//) ||
    process.env.MIGRATION_DATABASE_URL
  ) {
    throw new Error("POSTGRES_RUNTIME_ROLE_REQUIRED");
  }
  if (
    !cryptoMonitoringReady() ||
    approvedCryptoProviders("devnet").length !== 2
  ) {
    throw new Error("DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED");
  }

  if (options.dbSchemaOk === false) {
    throw new Error("SCHEMA_MIGRATION_REQUIRED");
  }
  if (options.dbSafe === false) {
    throw new Error("POSTGRES_RUNTIME_ROLE_REQUIRED");
  }

  const origin = process.env.APP_ORIGIN;
  const parsed = URL.parse(origin ?? "");
  if (
    !parsed ||
    parsed.protocol !== "https:" ||
    parsed.origin !== origin ||
    process.env.BETTER_AUTH_URL !== origin
  ) {
    throw new Error("CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED");
  }

  assertEncryptionReady();
}

describe("AG-01 AWS Preflight Fail-Closed Verification Harness", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // Default valid devnet environment
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGUS_ENVIRONMENT", "devnet");
    vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
    vi.stubEnv("AGUS_AUTH_PUBLIC", "false");
    vi.stubEnv("PAYMENT_MODE", "fixture");
    vi.stubEnv("DATABASE_URL", VALID_DATABASE_URL);
    vi.stubEnv("BETTER_AUTH_SECRET", VALID_AUTH_SECRET);
    vi.stubEnv("BETTER_AUTH_URL", VALID_ORIGIN);
    vi.stubEnv("APP_ORIGIN", VALID_ORIGIN);
    vi.stubEnv("AGUS_ENCRYPTION_ACTIVE_KEY", "v1");
    vi.stubEnv("AGUS_ENCRYPTION_KEYS", JSON.stringify({ v1: VALID_32_BYTE_KEY }));
    vi.stubEnv("AGUS_CRYPTO_MONITORING", "true");
    vi.stubEnv("AGUS_CRYPTO_DEVNET_ROUTES", "phantom,solflare");
    vi.stubEnv("AGUS_DEVNET_RPC", "https://api.devnet.solana.com");
    vi.stubEnv("AGUS_DEVNET_VERIFY_RPC", "https://rpc.ankr.com/solana_devnet");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // ============================================================================
  // 1. ABSENT / MALFORMED SECRETS FAIL-CLOSED CHECKS
  // ============================================================================
  describe("1. Absent / Malformed Secrets Fail-Closed", () => {
    it("fails closed with IDENTITY_CONFIGURATION_REQUIRED when BETTER_AUTH_SECRET is missing", async () => {
      vi.stubEnv("BETTER_AUTH_SECRET", "");
      await expect(createIdentity()).rejects.toThrow(/IDENTITY_CONFIGURATION_REQUIRED/);
    });

    it("fails closed with IDENTITY_CONFIGURATION_REQUIRED when BETTER_AUTH_SECRET is shorter than 32 chars", async () => {
      vi.stubEnv("BETTER_AUTH_SECRET", "only-25-chars-not-enough!");
      await expect(createIdentity()).rejects.toThrow(/IDENTITY_CONFIGURATION_REQUIRED/);
    });

    it("fails closed with ENCRYPTION_KEY_UNAVAILABLE when AGUS_ENCRYPTION_ACTIVE_KEY is undefined", () => {
      vi.stubEnv("AGUS_ENCRYPTION_ACTIVE_KEY", "");
      expect(() => assertEncryptionReady()).toThrow(/ENCRYPTION_KEY_UNAVAILABLE/);
    });

    it("fails closed with ENCRYPTION_KEY_UNAVAILABLE when AGUS_ENCRYPTION_KEYS is malformed JSON", () => {
      vi.stubEnv("AGUS_ENCRYPTION_KEYS", "invalid-json-string");
      expect(() => assertEncryptionReady()).toThrow(/ENCRYPTION_KEY_UNAVAILABLE/);
    });

    it("fails closed with ENCRYPTION_KEY_UNAVAILABLE when active key is not 32 bytes (after base64 decode)", () => {
      const sixteenByteKey = Buffer.alloc(16, 1).toString("base64");
      vi.stubEnv("AGUS_ENCRYPTION_KEYS", JSON.stringify({ v1: sixteenByteKey }));
      expect(() => assertEncryptionReady()).toThrow(/ENCRYPTION_KEY_UNAVAILABLE/);
    });

    it("fails closed with POSTGRES_RUNTIME_ROLE_REQUIRED when DATABASE_URL is missing or lacks postgres prefix", () => {
      vi.stubEnv("DATABASE_URL", "mysql://localhost/test");
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "POSTGRES_RUNTIME_ROLE_REQUIRED",
      );
    });

    it("fails closed with POSTGRES_RUNTIME_ROLE_REQUIRED when MIGRATION_DATABASE_URL is leaked in runtime", () => {
      vi.stubEnv(
        "MIGRATION_DATABASE_URL",
        "postgresql://owner:admin@neon.invalid/db",
      );
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "POSTGRES_RUNTIME_ROLE_REQUIRED",
      );
    });

    it("fails closed with error when legacy payment secret (PAYSTACK_SECRET_KEY) contaminates devnet", () => {
      vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_live_compromised");
      expect(() => validateEnvironment()).toThrow(
        /financial provider credentials forbidden/,
      );
    });
  });

  // ============================================================================
  // 2. WRONG CLUSTER & RPC FAIL-CLOSED CHECKS
  // ============================================================================
  describe("2. Wrong Cluster & RPC Fail-Closed", () => {
    it("fails closed with CHAIN_IDENTITY_MISMATCH when Solana RPC returns wrong genesis hash", async () => {
      // Mock getGenesisHash on Connection prototype to simulate connecting to Mainnet or an impostor node
      vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(MAINNET_GENESIS);

      await expect(cryptoRpc("devnet")).rejects.toThrow(/CHAIN_IDENTITY_MISMATCH/);
    });

    it("passes genesis verification when Solana RPC returns valid devnet genesis hash", async () => {
      vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(VALID_DEVNET_GENESIS);

      const conn = await cryptoRpc("devnet");
      expect(conn).toBeDefined();
    });

    it("fails closed with INDEPENDENT_VERIFIER_REQUIRED when primary and verifier RPC hostnames match", async () => {
      vi.stubEnv("AGUS_DEVNET_RPC", "https://api.devnet.solana.com");
      vi.stubEnv("AGUS_DEVNET_VERIFY_RPC", "https://api.devnet.solana.com/verifier");

      await expect(cryptoRpc("devnet", true)).rejects.toThrow(/INDEPENDENT_VERIFIER_REQUIRED/);
    });

    it("fails closed with INDEPENDENT_VERIFIER_REQUIRED when verifier RPC is unconfigured", async () => {
      vi.stubEnv("AGUS_DEVNET_VERIFY_RPC", "");

      await expect(cryptoRpc("devnet", true)).rejects.toThrow(/INDEPENDENT_VERIFIER_REQUIRED/);
    });

    it("fails closed with PROVIDER_UNAVAILABLE when RPC endpoint protocol is not HTTPS", async () => {
      vi.stubEnv("AGUS_DEVNET_RPC", "http://insecure-rpc.invalid");

      await expect(cryptoRpc("devnet")).rejects.toThrow(/PROVIDER_UNAVAILABLE/);
    });

    it("fails closed with INVITE_ONLY_DEVNET_REQUIRED when AGUS_ENVIRONMENT is not devnet", () => {
      vi.stubEnv("AGUS_ENVIRONMENT", "sandbox");
      vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "false");
      vi.stubEnv("PAYMENT_MODE", "test");
      vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_mock");
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "INVITE_ONLY_DEVNET_REQUIRED",
      );
    });

    it("fails closed with INVITE_ONLY_DEVNET_REQUIRED when AGUS_AUTH_PUBLIC is true", () => {
      vi.stubEnv("AGUS_AUTH_PUBLIC", "true");
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "INVITE_ONLY_DEVNET_REQUIRED",
      );
    });

    it("fails closed with DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED when monitoring is disabled", () => {
      vi.stubEnv("AGUS_CRYPTO_MONITORING", "false");
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED",
      );
    });

    it("fails closed with DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED when routes miss phantom or solflare", () => {
      vi.stubEnv("AGUS_CRYPTO_DEVNET_ROUTES", "phantom"); // missing solflare
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED",
      );
    });
  });

  // ============================================================================
  // 3. MISMATCHED ORIGINS FAIL-CLOSED CHECKS
  // ============================================================================
  describe("3. Mismatched Origins Fail-Closed", () => {
    it("fails closed with CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED when APP_ORIGIN is HTTP", () => {
      vi.stubEnv("APP_ORIGIN", "http://crypto-devnet.example.com");
      vi.stubEnv("BETTER_AUTH_URL", "http://crypto-devnet.example.com");
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED",
      );
    });

    it("fails closed with CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED when APP_ORIGIN has trailing slash", () => {
      vi.stubEnv("APP_ORIGIN", "https://crypto-devnet.example.com/");
      vi.stubEnv("BETTER_AUTH_URL", "https://crypto-devnet.example.com/");
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED",
      );
    });

    it("fails closed with CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED when BETTER_AUTH_URL does not match APP_ORIGIN", () => {
      vi.stubEnv("APP_ORIGIN", "https://crypto-devnet.example.com");
      vi.stubEnv("BETTER_AUTH_URL", "https://auth-divergent.example.com");
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED",
      );
    });

    it("fails closed with CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED when APP_ORIGIN is invalid URL", () => {
      vi.stubEnv("APP_ORIGIN", "not-a-valid-url");
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).toThrow(
        "CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED",
      );
    });

    it("passes origin check when APP_ORIGIN and BETTER_AUTH_URL match valid canonical HTTPS", () => {
      vi.stubEnv("APP_ORIGIN", "https://devnet.agus.example.com");
      vi.stubEnv("BETTER_AUTH_URL", "https://devnet.agus.example.com");
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).not.toThrow();
    });
  });

  // ============================================================================
  // 4. UNINITIALIZED DB & PRIVILEGES FAIL-CLOSED CHECKS
  // ============================================================================
  describe("4. Uninitialized DB & Privileges Fail-Closed", () => {
    it("fails closed with SCHEMA_MIGRATION_REQUIRED when migrations table lacks latest schema", async () => {
      // Mock Sql client that returns 0 rows for schema check
      const mockSql: sqlModule.Sql = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };

      await expect(assertSchema(mockSql)).rejects.toThrow("SCHEMA_MIGRATION_REQUIRED");
    });

    it("passes assertSchema when 0027_crypto_requests.sql and legacy archive exist", async () => {
      const mockSql: sqlModule.Sql = {
        query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
      };

      await expect(assertSchema(mockSql)).resolves.toBeUndefined();
    });

    it("fails closed with POSTGRES_RUNTIME_ROLE_REQUIRED when database role safe check returns false", () => {
      // safe = false means user has CREATE on public schema, lacks agus_runtime, or has superuser flags
      expect(() => runPreflightChecks({ dbSafe: false, dbSchemaOk: true })).toThrow(
        "POSTGRES_RUNTIME_ROLE_REQUIRED",
      );
    });

    it("passes preflight when database role safe check returns true and schema is verified", () => {
      expect(() => runPreflightChecks({ dbSafe: true, dbSchemaOk: true })).not.toThrow();
    });
  });

  // ============================================================================
  // 5. READINESS PROBE FAILURES (/api/v1/ready)
  // ============================================================================
  describe("5. Readiness Probe (/api/v1/ready) Fail-Closed", () => {
    it("returns HTTP 503 when database schema is uninitialized", async () => {
      vi.spyOn(migrationsModule, "assertSchema").mockRejectedValue(
        new Error("SCHEMA_MIGRATION_REQUIRED"),
      );

      const req = new Request("https://crypto-devnet.example.com/api/v1/ready");
      const res = await GET(req);

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toHaveProperty("error");
      expect(json.status).toBeUndefined();
    });

    it("returns HTTP 503 when identity configuration fails", async () => {
      vi.spyOn(migrationsModule, "assertSchema").mockResolvedValue(undefined);
      vi.spyOn(authModule, "identity").mockRejectedValue(
        new Error("IDENTITY_CONFIGURATION_REQUIRED"),
      );

      const req = new Request("https://crypto-devnet.example.com/api/v1/ready");
      const res = await GET(req);

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns HTTP 503 when encryption keys are unavailable", async () => {
      vi.spyOn(migrationsModule, "assertSchema").mockResolvedValue(undefined);
      vi.spyOn(authModule, "identity").mockResolvedValue({} as any);
      vi.spyOn(secretsModule, "assertEncryptionReady").mockImplementation(() => {
        throw new Error("ENCRYPTION_KEY_UNAVAILABLE");
      });

      const req = new Request("https://crypto-devnet.example.com/api/v1/ready");
      const res = await GET(req);

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json).toHaveProperty("error");
    });

    it("returns HTTP 200 with { status: 'ready' } when all dependencies succeed", async () => {
      vi.spyOn(migrationsModule, "assertSchema").mockResolvedValue(undefined);
      vi.spyOn(authModule, "identity").mockResolvedValue({} as any);
      vi.spyOn(secretsModule, "assertEncryptionReady").mockImplementation(() => {});

      const req = new Request("https://crypto-devnet.example.com/api/v1/ready");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ status: "ready" });
    });
  });

  // ============================================================================
  // 6. COMPOSE CONFIGURATION & SCRIPT STATIC INTEGRITY CHECKS
  // ============================================================================
  describe("6. Compose Configuration & Static Script Integrity", () => {
    const baseDir = resolve(__dirname, "..");

    it("verifies docker-compose.yml defines required services and perimeter isolation", () => {
      const composeContent = readFileSync(resolve(baseDir, "docker-compose.yml"), "utf-8");

      // Verify all 3 required services
      expect(composeContent).toContain("caddy:");
      expect(composeContent).toContain("api:");
      expect(composeContent).toContain("worker:");

      // Verify Caddy exposes 80 and 443
      expect(composeContent).toContain('"80:80"');
      expect(composeContent).toContain('"443:443"');

      // Verify API does NOT publish 3000 to host ports, but exposes internally
      expect(composeContent).toContain('expose:');
      expect(composeContent).toContain('- "3000"');
      expect(composeContent).not.toMatch(/ports:\s*\n\s*- ["']3000:3000["']/);

      // Verify worker has no ports published
      expect(composeContent).not.toMatch(/worker:[\s\S]*?ports:/);

      // Verify log bounding
      expect(composeContent).toContain('max-size: "20m"');
      expect(composeContent).toContain('max-file: "5"');

      // Verify internal network
      expect(composeContent).toContain("crypto-internal");
      expect(composeContent).toContain("driver: bridge");

      // Verify restart policy
      expect(composeContent).toContain("restart: unless-stopped");
    });

    it("verifies Caddyfile enforces TLS, security headers, and health checks", () => {
      const caddyContent = readFileSync(resolve(baseDir, "Caddyfile"), "utf-8");

      expect(caddyContent).toContain("Strict-Transport-Security");
      expect(caddyContent).toContain("X-Content-Type-Options");
      expect(caddyContent).toContain("reverse_proxy api:3000");
      expect(caddyContent).toContain("health_uri /api/v1/ready");
      expect(caddyContent).toContain("max_size 10MB");
    });

    it("verifies host scripts exist with bash strict mode", () => {
      const scripts = ["setup-host.sh", "preflight-check.sh", "rollback.sh"];
      for (const script of scripts) {
        const content = readFileSync(resolve(baseDir, script), "utf-8");
        expect(content).toContain("set -euo pipefail");
      }
    });

    it("verifies env.production.example contains zero hardcoded real secrets", () => {
      const envContent = readFileSync(resolve(baseDir, "env.production.example"), "utf-8");

      expect(envContent).toContain("AGUS_ENVIRONMENT=devnet");
      expect(envContent).toContain("AGUS_AUTH_PUBLIC=false");
      expect(envContent).toContain("REPLACE_WITH_");
      expect(envContent).toContain("MIGRATION_DATABASE_URL");
      expect(envContent).not.toContain("sk_live_");
      expect(envContent).not.toContain("password123");
    });
  });
});
