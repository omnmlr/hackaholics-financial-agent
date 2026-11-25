import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection } from "@solana/web3.js";
import { PGlite } from "@electric-sql/pglite";
import { validateEnvironment } from "@/lib/environment";
import { createIdentity } from "@/server/auth";
import { assertEncryptionReady } from "@/server/secrets";
import { assertSchema, migrate } from "@/server/migrations";
import { cryptoRpc } from "@/server/crypto/rpc";
import { GET } from "@/app/api/v1/[...path]/route";
import * as sqlModule from "@/server/sql";
import * as authModule from "@/server/auth";
import * as secretsModule from "@/server/secrets";
import * as migrationsModule from "@/server/migrations";

const execFileAsync = promisify(execFile);

// Repository root and helper paths
const awsDeployDir = resolve(__dirname, "..");
const repoRoot = resolve(awsDeployDir, "../../..");
const harnessPath = resolve(__dirname, "helpers/devnet-harness.mjs");

// Canonical test fixtures
const VALID_DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const VALID_32_BYTE_KEY = Buffer.alloc(32, 7).toString("base64");
const VALID_AUTH_SECRET = "sample-32-char-random-secret-for-auth-testing-only";
const VALID_ORIGIN = "https://crypto-devnet.example.com";
const VALID_DATABASE_URL =
  "postgresql://agus_crypto_devnet_runtime:secret@neon-mock.invalid/agus_crypto_devnet_20261124?sslmode=require";

function buildBaseDevnetEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  // Clear potentially inherited overrides/forbidden vars
  for (const key of [
    "PAYSTACK_SECRET_KEY",
    "MIGRATION_DATABASE_URL",
    "LIVE_TRANSFERS_ENABLED",
    "LIVE_OWNER_AUTHORIZED",
    "PAYSTACK_TRANSFERS_ENABLED",
    "LIVE_WEBHOOK_VALIDATED",
    "LIVE_RECONCILIATION_VALIDATED",
    "TEST_HARNESS_DB_MODE",
    "TEST_HARNESS_SNAPSHOT_PATH",
    "TEST_HARNESS_RPC_GENESIS",
  ]) {
    delete env[key];
  }
  return {
    ...env,
    NODE_ENV: "production",
    AGUS_ENVIRONMENT: "devnet",
    AGUS_SOLANA_DEVNET_ENABLED: "true",
    AGUS_AUTH_PUBLIC: "false",
    PAYMENT_MODE: "fixture",
    DATABASE_URL: VALID_DATABASE_URL,
    BETTER_AUTH_SECRET: VALID_AUTH_SECRET,
    BETTER_AUTH_URL: VALID_ORIGIN,
    APP_ORIGIN: VALID_ORIGIN,
    AGUS_ENCRYPTION_ACTIVE_KEY: "v1",
    AGUS_ENCRYPTION_KEYS: JSON.stringify({ v1: VALID_32_BYTE_KEY }),
    AGUS_CRYPTO_MONITORING: "true",
    AGUS_CRYPTO_DEVNET_ROUTES: "phantom,solflare",
    AGUS_DEVNET_RPC: "https://api.devnet.solana.com",
    AGUS_DEVNET_VERIFY_RPC: "https://rpc.ankr.com/solana_devnet",
  };
}

let tempSnapshotDir = "";
let snapshotPath = "";

const MAX_PARALLEL_SUBPROCESSES = 3;
let activeSubprocesses = 0;
const subprocessWaiters: Array<() => void> = [];

async function acquireSubprocessSlot() {
  if (activeSubprocesses < MAX_PARALLEL_SUBPROCESSES) {
    activeSubprocesses++;
    return;
  }
  await new Promise<void>((resolveWaiter) => subprocessWaiters.push(resolveWaiter));
  activeSubprocesses++;
}

function releaseSubprocessSlot() {
  activeSubprocesses--;
  const next = subprocessWaiters.shift();
  if (next) next();
}

async function runCryptoDevnet(
  envOverrides: Record<string, string | undefined>,
  options: {
    args?: string[];
    dbMode?: "uninitialized" | "superuser" | "missing-role" | "public-create" | "valid-runtime";
    rpcGenesis?: string;
    useHarness?: boolean;
  } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env: Record<string, string | undefined> = {
    ...buildBaseDevnetEnv(),
    ...envOverrides,
  };

  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete env[k];
  }

  const nodeArgs = ["--import", "tsx"];
  if (options.useHarness) {
    nodeArgs.push("--import", pathToFileURL(harnessPath).href);
    if (options.dbMode) {
      env.TEST_HARNESS_DB_MODE = options.dbMode;
      if (options.dbMode !== "uninitialized" && snapshotPath) {
        env.TEST_HARNESS_SNAPSHOT_PATH = snapshotPath;
      }
    }
    if (options.rpcGenesis) {
      env.TEST_HARNESS_RPC_GENESIS = options.rpcGenesis;
    }
  }
  nodeArgs.push("scripts/crypto-devnet.ts", ...(options.args ?? ["api"]));

  await acquireSubprocessSlot();
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, nodeArgs, {
      cwd: repoRoot,
      env: env as NodeJS.ProcessEnv,
      timeout: 50000,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (err: unknown) {
    const execErr = err as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof execErr.code === "number" ? execErr.code : 1,
      stdout: execErr.stdout ?? "",
      stderr: execErr.stderr ?? "",
    };
  } finally {
    releaseSubprocessSlot();
  }
}

describe.concurrent("AG-01 Genuine Startup Subprocess Verification (scripts/crypto-devnet.ts)", () => {
  vi.setConfig({ testTimeout: 180000, hookTimeout: 60000 });

  beforeAll(async () => {
    // Build a real PostgreSQL (PGlite) snapshot once using actual migrations 0001..0027 + runtime-role.sql
    tempSnapshotDir = await mkdtemp(join(tmpdir(), "agus-ag01-pg-"));
    snapshotPath = join(tempSnapshotDir, "migrated.tar");
    const db = new PGlite();
    await migrate(db, resolve(repoRoot, "migrations"), false);
    const roleSql = await readFile(resolve(repoRoot, "scripts/sql/runtime-role.sql"), "utf8");
    await db.exec(roleSql);
    await db.exec(
      "CREATE ROLE agus_crypto_devnet_runtime LOGIN IN ROLE agus_runtime; CREATE ROLE agus_no_role LOGIN; GRANT SELECT ON agus_migrations, agus_legacy_archive TO agus_no_role;",
    );
    const dump = await db.dumpDataDir("none");
    await writeFile(snapshotPath, Buffer.from(await dump.arrayBuffer()));
    await db.close();
  }, 60000);

  afterAll(async () => {
    if (tempSnapshotDir) {
      await rm(tempSnapshotDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 1. GENUINE STARTUP SUBPROCESS: PRE-DB SECRETS, CLUSTER & ENV FAIL-CLOSED
  //    (Invokes unmodified scripts/crypto-devnet.ts directly via Node subprocess)
  // ============================================================================
  describe("1. Genuine Process Invocation: Pre-DB Secrets, Cluster & Flags", () => {
    it("exits 1 with START_MODE_REQUIRED when start mode is invalid", async () => {
      const res = await runCryptoDevnet({}, { args: ["invalid"] });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("START_MODE_REQUIRED");
    });

    it("exits 1 when AGUS_ENVIRONMENT is sandbox without Paystack credentials", async () => {
      const res = await runCryptoDevnet({
        AGUS_ENVIRONMENT: "sandbox",
        AGUS_AUTH_PUBLIC: "false",
      });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (STARTUP_CHECK_FAILED)");
    });

    it("exits 1 with INVITE_ONLY_DEVNET_REQUIRED when profile is sandbox even with mock Paystack key", async () => {
      const res = await runCryptoDevnet({
        AGUS_ENVIRONMENT: "sandbox",
        AGUS_SOLANA_DEVNET_ENABLED: "false",
        PAYMENT_MODE: "test",
        PAYSTACK_SECRET_KEY: "sk_test_mock",
      });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (INVITE_ONLY_DEVNET_REQUIRED)");
    });

    it("exits 1 when legacy PAYSTACK_SECRET_KEY contaminates devnet", async () => {
      const res = await runCryptoDevnet({
        PAYSTACK_SECRET_KEY: "sk_live_compromised",
      });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (STARTUP_CHECK_FAILED)");
    });

    it("exits 1 with INVITE_ONLY_DEVNET_REQUIRED when AGUS_AUTH_PUBLIC is true without Resend settings", async () => {
      const res = await runCryptoDevnet({ AGUS_AUTH_PUBLIC: "true" });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (INVITE_ONLY_DEVNET_REQUIRED)");
    });

    it("exits 0 when AGUS_AUTH_PUBLIC is true with RESEND_API_KEY, AGUS_AUTH_EMAIL_FROM, and HTTPS origin", async () => {
      const res = await runCryptoDevnet(
        {
          AGUS_AUTH_PUBLIC: "true",
          RESEND_API_KEY: "re_fixture_only",
          AGUS_AUTH_EMAIL_FROM: "AGUS <noreply@mail.fixture.invalid>",
        },
        { useHarness: true, dbMode: "valid-runtime", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("Crypto Devnet API startup verified");
    });

    it("exits 1 with POSTGRES_RUNTIME_ROLE_REQUIRED when DATABASE_URL lacks postgres prefix", async () => {
      const res = await runCryptoDevnet({ DATABASE_URL: "mysql://localhost/test" });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (POSTGRES_RUNTIME_ROLE_REQUIRED)");
    });

    it("exits 1 with POSTGRES_RUNTIME_ROLE_REQUIRED when MIGRATION_DATABASE_URL is leaked", async () => {
      const res = await runCryptoDevnet({
        MIGRATION_DATABASE_URL: "postgresql://owner:admin@neon.invalid/db",
      });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (POSTGRES_RUNTIME_ROLE_REQUIRED)");
    });

    it("exits 1 with DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED when monitoring is disabled", async () => {
      const res = await runCryptoDevnet({ AGUS_CRYPTO_MONITORING: "false" });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain(
        "Crypto Devnet startup failed (DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED)",
      );
    });

    it("exits 1 with DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED when routes omit solflare", async () => {
      const res = await runCryptoDevnet({ AGUS_CRYPTO_DEVNET_ROUTES: "phantom" });
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain(
        "Crypto Devnet startup failed (DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED)",
      );
    });
  });

  // ============================================================================
  // 2. GENUINE STARTUP SUBPROCESS: REAL PGLITE DB, SQL PRIVILEGES, RPC, ORIGIN,
  //    ENCRYPTION, IDENTITY & FULL EXIT-0 VERIFICATION
  // ============================================================================
  describe("2. Genuine Process Invocation: DB Privileges, RPC, Origin, Secrets & Exit 0", () => {
    it("exits 1 with SCHEMA_MIGRATION_REQUIRED when DB schema is uninitialized", async () => {
      const res = await runCryptoDevnet(
        {},
        { useHarness: true, dbMode: "uninitialized", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (SCHEMA_MIGRATION_REQUIRED)");
    });

    it("exits 1 with POSTGRES_RUNTIME_ROLE_REQUIRED when DB connection runs as superuser", async () => {
      const res = await runCryptoDevnet(
        {},
        { useHarness: true, dbMode: "superuser", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (POSTGRES_RUNTIME_ROLE_REQUIRED)");
    });

    it("exits 1 with POSTGRES_RUNTIME_ROLE_REQUIRED when runtime role has CREATE on public schema", async () => {
      const res = await runCryptoDevnet(
        {},
        { useHarness: true, dbMode: "public-create", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (POSTGRES_RUNTIME_ROLE_REQUIRED)");
    });

    it("exits 1 with POSTGRES_RUNTIME_ROLE_REQUIRED when DB user lacks agus_runtime membership", async () => {
      const res = await runCryptoDevnet(
        {},
        { useHarness: true, dbMode: "missing-role", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (POSTGRES_RUNTIME_ROLE_REQUIRED)");
    });

    it("exits 1 with CHAIN_IDENTITY_MISMATCH when RPC returns mainnet genesis hash", async () => {
      const res = await runCryptoDevnet(
        {},
        { useHarness: true, dbMode: "valid-runtime", rpcGenesis: MAINNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (CHAIN_IDENTITY_MISMATCH)");
    });

    it("exits 1 with CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED when APP_ORIGIN uses HTTP", async () => {
      const res = await runCryptoDevnet(
        {
          APP_ORIGIN: "http://crypto-devnet.example.com",
          BETTER_AUTH_URL: "http://crypto-devnet.example.com",
        },
        { useHarness: true, dbMode: "valid-runtime", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain(
        "Crypto Devnet startup failed (CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED)",
      );
    });

    it("exits 1 with CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED when APP_ORIGIN has trailing slash", async () => {
      const res = await runCryptoDevnet(
        {
          APP_ORIGIN: "https://crypto-devnet.example.com/",
          BETTER_AUTH_URL: "https://crypto-devnet.example.com/",
        },
        { useHarness: true, dbMode: "valid-runtime", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain(
        "Crypto Devnet startup failed (CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED)",
      );
    });

    it("exits 1 with CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED when BETTER_AUTH_URL diverges from APP_ORIGIN", async () => {
      const res = await runCryptoDevnet(
        {
          APP_ORIGIN: "https://crypto-devnet.example.com",
          BETTER_AUTH_URL: "https://auth-divergent.example.com",
        },
        { useHarness: true, dbMode: "valid-runtime", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain(
        "Crypto Devnet startup failed (CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED)",
      );
    });

    it("exits 1 with ENCRYPTION_KEY_UNAVAILABLE when AGUS_ENCRYPTION_KEYS is invalid JSON", async () => {
      const res = await runCryptoDevnet(
        { AGUS_ENCRYPTION_KEYS: "invalid-json" },
        { useHarness: true, dbMode: "valid-runtime", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (ENCRYPTION_KEY_UNAVAILABLE)");
    });

    it("exits 1 with IDENTITY_CONFIGURATION_REQUIRED when BETTER_AUTH_SECRET is < 32 chars", async () => {
      const res = await runCryptoDevnet(
        { BETTER_AUTH_SECRET: "too-short" },
        { useHarness: true, dbMode: "valid-runtime", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain("Crypto Devnet startup failed (IDENTITY_CONFIGURATION_REQUIRED)");
    });

    it("exits 0 and prints verified startup message on valid devnet configuration", async () => {
      const res = await runCryptoDevnet(
        {},
        { useHarness: true, dbMode: "valid-runtime", rpcGenesis: VALID_DEVNET_GENESIS },
      );
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain("Crypto Devnet API startup verified");
    });
  });
});

describe("AG-01 Modular Guards, Readiness Probe & Static Configuration", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
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
  // 3. MODULAR BACKEND UNIT ASSERTIONS (Secrets, RPC, Schema)
  // ============================================================================
  describe("3. Modular Backend Guard Assertions", () => {
    it("fails closed with IDENTITY_CONFIGURATION_REQUIRED when BETTER_AUTH_SECRET is missing", async () => {
      vi.stubEnv("BETTER_AUTH_SECRET", "");
      await expect(createIdentity()).rejects.toThrow(/IDENTITY_CONFIGURATION_REQUIRED/);
    });

    it("fails closed with ENCRYPTION_KEY_UNAVAILABLE when AGUS_ENCRYPTION_ACTIVE_KEY is undefined", () => {
      vi.stubEnv("AGUS_ENCRYPTION_ACTIVE_KEY", "");
      expect(() => assertEncryptionReady()).toThrow(/ENCRYPTION_KEY_UNAVAILABLE/);
    });

    it("fails closed with ENCRYPTION_KEY_UNAVAILABLE when active key is not 32 bytes", () => {
      const sixteenByteKey = Buffer.alloc(16, 1).toString("base64");
      vi.stubEnv("AGUS_ENCRYPTION_KEYS", JSON.stringify({ v1: sixteenByteKey }));
      expect(() => assertEncryptionReady()).toThrow(/ENCRYPTION_KEY_UNAVAILABLE/);
    });

    it("rejects legacy PAYSTACK_SECRET_KEY in validateEnvironment() for devnet", () => {
      vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_live_compromised");
      expect(() => validateEnvironment()).toThrow(/financial provider credentials forbidden/);
    });

    // Note: Must run before valid-genesis check for the same URL because rpc.ts caches pinUntil=60s.
    it("fails closed with CHAIN_IDENTITY_MISMATCH when Solana RPC returns wrong genesis hash", async () => {
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

    it("fails closed with SCHEMA_MIGRATION_REQUIRED when assertSchema gets 0 rows", async () => {
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
  });

  // ============================================================================
  // 4. READINESS PROBE FAILURES (/api/v1/ready)
  // ============================================================================
  describe("4. Readiness Probe (/api/v1/ready) Fail-Closed", () => {
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
      vi.spyOn(authModule, "identity").mockResolvedValue(
        {} as Awaited<ReturnType<typeof authModule.createIdentity>>,
      );
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
      vi.spyOn(authModule, "identity").mockResolvedValue(
        {} as Awaited<ReturnType<typeof authModule.createIdentity>>,
      );
      vi.spyOn(secretsModule, "assertEncryptionReady").mockImplementation(() => {});

      const req = new Request("https://crypto-devnet.example.com/api/v1/ready");
      const res = await GET(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ status: "ready" });
    });
  });

  // ============================================================================
  // 5. COMPOSE CONFIGURATION, RUNBOOK & SCRIPT STATIC INTEGRITY CHECKS
  // ============================================================================
  describe("5. Compose Configuration, Runbook & Script Integrity", () => {
    it("verifies docker-compose.yml passes APP_DOMAIN to caddy, pins release image, and avoids default on-host build", () => {
      const composeContent = readFileSync(resolve(awsDeployDir, "docker-compose.yml"), "utf-8");

      // Required services & perimeter isolation
      expect(composeContent).toContain("caddy:");
      expect(composeContent).toContain("api:");
      expect(composeContent).toContain("worker:");
      expect(composeContent).toContain('"80:80"');
      expect(composeContent).toContain('"443:443"');
      expect(composeContent).toContain("expose:");
      expect(composeContent).toContain('- "3000"');
      expect(composeContent).not.toMatch(/ports:\s*\n\s*- ["']3000:3000["']/);
      expect(composeContent).not.toMatch(/worker:[\s\S]*?ports:/);

      // Caddy receives APP_DOMAIN only, without full secret env_file
      const caddyBlock = composeContent.split(/\n {2}api:/)[0] ?? "";
      expect(caddyBlock).toMatch(/APP_DOMAIN=\$\{APP_DOMAIN:\?/);
      expect(caddyBlock).not.toContain("env_file:");

      // Commit-pinned image tag and no accidental default next build on t3.small
      expect(composeContent).toContain("${AGUS_RELEASE_SHA:?");
      expect(composeContent).not.toContain(":devnet");
      expect(composeContent).not.toMatch(/^\s*build:/m);

      // Bounded logging, internal bridge network, restart policy
      expect(composeContent).toContain('max-size: "20m"');
      expect(composeContent).toContain('max-file: "5"');
      expect(composeContent).toContain("crypto-internal");
      expect(composeContent).toContain("driver: bridge");
      expect(composeContent).toContain("restart: unless-stopped");
    });

    it("verifies docker-compose.build.yml provides explicit opt-in build override", () => {
      const buildOverride = readFileSync(
        resolve(awsDeployDir, "docker-compose.build.yml"),
        "utf-8",
      );
      expect(buildOverride).toContain("api:");
      expect(buildOverride).toContain("dockerfile: deploy/crypto/Dockerfile");
    });

    it("verifies Caddyfile enforces TLS, security headers, and health checks", () => {
      const caddyContent = readFileSync(resolve(awsDeployDir, "Caddyfile"), "utf-8");

      expect(caddyContent).toContain("{$APP_DOMAIN:localhost}");
      expect(caddyContent).toContain("Strict-Transport-Security");
      expect(caddyContent).toContain("X-Content-Type-Options");
      expect(caddyContent).toContain("reverse_proxy api:3000");
      expect(caddyContent).toContain("health_uri /api/v1/ready");
      expect(caddyContent).toContain("max_size 10MB");
    });

    it("verifies README.md documents --env-file /etc/agus/crypto.env, pinned off-host build, and swap guidance", () => {
      const readme = readFileSync(resolve(awsDeployDir, "README.md"), "utf-8");
      expect(readme).toContain("docker compose --env-file /etc/agus/crypto.env up -d");
      expect(readme).toContain("AGUS_RELEASE_SHA");
      expect(readme).toContain("docker-compose.build.yml");
      expect(readme).toContain("/swapfile");
    });

    it("verifies host scripts use bash strict mode and preflight-check.sh rejects placeholders and missing routes/monitoring", () => {
      const scripts = ["setup-host.sh", "preflight-check.sh", "rollback.sh"];
      for (const script of scripts) {
        const content = readFileSync(resolve(awsDeployDir, script), "utf-8");
        expect(content).toContain("set -euo pipefail");
      }

      const preflight = readFileSync(resolve(awsDeployDir, "preflight-check.sh"), "utf-8");
      expect(preflight).toContain("REPLACE_WITH_");
      expect(preflight).toContain("AGUS_CRYPTO_MONITORING");
      expect(preflight).toContain("AGUS_CRYPTO_DEVNET_ROUTES");
      expect(preflight).toContain("AGUS_RELEASE_SHA");
      expect(preflight).toContain("APP_DOMAIN");
      expect(preflight).toContain("JSON.parse");
    });

    it("verifies env.production.example contains zero hardcoded real secrets and includes AGUS_RELEASE_SHA", () => {
      const envContent = readFileSync(resolve(awsDeployDir, "env.production.example"), "utf-8");

      expect(envContent).toContain("AGUS_RELEASE_SHA=REPLACE_WITH_GIT_COMMIT_SHA");
      expect(envContent).toContain("AGUS_ENVIRONMENT=devnet");
      expect(envContent).toContain("AGUS_AUTH_PUBLIC=false");
      expect(envContent).toContain("REPLACE_WITH_");
      expect(envContent).toContain("MIGRATION_DATABASE_URL");
      expect(envContent).not.toContain("sk_live_");
      expect(envContent).not.toContain("password123");
    });
  });
});
