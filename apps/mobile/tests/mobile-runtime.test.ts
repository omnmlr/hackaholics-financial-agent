/** Automated mobile runtime tests for auth/session, SecureStore, MWA wallet signing, and notifications. */
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DevnetDraft } from "@agus/contracts";

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

describe("mobile session, SecureStore, biometric lock, and notifications", () => {
  const store = new Map<string, string>();
  let hasHardware = true;
  let isEnrolled = true;
  let authSuccess = true;
  let signInResult: { data?: unknown; error?: unknown } = { data: { user: { id: "u1" } } };
  let capturedSignInEmail = "";
  let cookieValue = "";
  let permissionStatus = "granted";
  let easProjectId: string | undefined = undefined;
  let pushTokenValue = "ExponentPushToken[fixture-token]";
  let pushTokenThrows = false;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    store.clear();
    hasHardware = true;
    isEnrolled = true;
    authSuccess = true;
    signInResult = { data: { user: { id: "u1" } } };
    capturedSignInEmail = "";
    cookieValue = "";
    permissionStatus = "granted";
    easProjectId = undefined;
    pushTokenValue = "ExponentPushToken[fixture-token]";
    pushTokenThrows = false;
    fetchMock.mockReset();

    vi.resetModules();
    vi.stubGlobal("__DEV__", false);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://agus.fixture.invalid/path");

    vi.doMock("react-native", () => ({
      Platform: { OS: "android" },
      AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    }));
    vi.doMock("expo-secure-store", () => ({
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
      getItem: (k: string) => store.get(k) ?? null,
      getItemAsync: async (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      setItemAsync: async (k: string, v: string) => void store.set(k, v),
      deleteItemAsync: async (k: string) => void store.delete(k),
    }));
    vi.doMock("expo-local-authentication", () => ({
      hasHardwareAsync: async () => hasHardware,
      isEnrolledAsync: async () => isEnrolled,
      authenticateAsync: async () => ({ success: authSuccess }),
    }));
    vi.doMock("expo-crypto", () => ({
      randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }));
    vi.doMock("expo-constants", () => ({
      default: {
        get expoConfig() {
          return {
            extra: easProjectId ? { eas: { projectId: easProjectId } } : {},
          };
        },
      },
    }));
    vi.doMock("expo-notifications", () => ({
      AndroidImportance: { DEFAULT: 3 },
      setNotificationChannelAsync: vi.fn(async () => {}),
      requestPermissionsAsync: vi.fn(async () => ({ status: permissionStatus })),
      getExpoPushTokenAsync: vi.fn(async () => {
        if (pushTokenThrows) throw new Error("TOKEN_UNAVAILABLE");
        return { data: pushTokenValue };
      }),
    }));
    vi.doMock("better-auth/react", () => ({
      createAuthClient: () => ({
        getCookie: async () => cookieValue,
        getSession: async () => ({ data: null }),
        signIn: {
          email: async ({ email }: { email: string; password: string }) => {
            capturedSignInEmail = email;
            return signInResult;
          },
        },
      }),
    }));
    vi.doMock("better-auth/client/plugins", () => ({
      twoFactorClient: () => ({}),
    }));
    vi.doMock("@better-auth/expo/client", () => ({
      expoClient: () => ({}),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("react-native");
    vi.doUnmock("expo-secure-store");
    vi.doUnmock("expo-local-authentication");
    vi.doUnmock("expo-crypto");
    vi.doUnmock("expo-constants");
    vi.doUnmock("expo-notifications");
    vi.doUnmock("better-auth/react");
    vi.doUnmock("better-auth/client/plugins");
    vi.doUnmock("@better-auth/expo/client");
  });

  it("enforces HTTPS outside dev loopback and requires EXPO_PUBLIC_API_URL", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    await expect(import("../src/session")).rejects.toThrow(
      "EXPO_PUBLIC_API_URL_REQUIRED",
    );

    vi.resetModules();
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://example.com");
    await expect(import("../src/session")).rejects.toThrow(
      "HTTPS_API_REQUIRED",
    );

    vi.resetModules();
    vi.stubGlobal("__DEV__", true);
    vi.stubEnv("EXPO_PUBLIC_API_URL", "http://10.0.2.2:3000");
    const devSession = await import("../src/session");
    expect(devSession.apiOrigin).toBe("http://10.0.2.2:3000");
  });

  it("gates SecureStore/API access behind biometric unlock, trims sign-in email, locks on failed sign-in, and wipes cookies on 401", async () => {
    const session = await import("../src/session");
    expect(session.apiOrigin).toBe("https://agus.fixture.invalid");

    await expect(session.apiRequest("me")).rejects.toThrow("LOCAL_SESSION_LOCKED");
    expect(fetchMock).not.toHaveBeenCalled();

    hasHardware = false;
    expect(await session.unlockSession()).toBe(false);
    hasHardware = true;
    isEnrolled = false;
    expect(await session.unlockSession()).toBe(false);
    isEnrolled = true;
    authSuccess = false;
    expect(await session.unlockSession()).toBe(false);

    store.set("agus_cookie", "stale-cookie");
    store.set("agus_session_data", "stale-data");
    signInResult = { error: { code: "INVALID_CREDENTIALS" } };
    await session.freshSignIn("  user@fixture.invalid  ", "fixture-password-123");
    expect(capturedSignInEmail).toBe("user@fixture.invalid");
    expect(store.has("agus_cookie")).toBe(false);
    expect(store.has("agus_session_data")).toBe(false);
    await expect(session.apiRequest("me")).rejects.toThrow("LOCAL_SESSION_LOCKED");

    authSuccess = true;
    expect(await session.unlockSession()).toBe(true);
    store.set("agus_cookie", "active-cookie");
    store.set("agus_session_data", "active-data");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await session.apiRequest("me");
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(firstHeaders.origin).toBe("agus://");
    expect(firstHeaders.cookie).toBeUndefined();

    cookieValue = "better-auth.session_token=fixture";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), {
        status: 401,
      }),
    );
    await expect(session.apiRequest("me")).rejects.toThrow(
      "SESSION_REVOKED_OR_EXPIRED",
    );
    expect(store.has("agus_cookie")).toBe(false);
    expect(store.has("agus_session_data")).toBe(false);
    await expect(session.apiRequest("me")).rejects.toThrow("LOCAL_SESSION_LOCKED");
  });

  it("handles notification permission denial, missing EAS projectId, valid registration, and invalid push tokens", async () => {
    const session = await import("../src/session");
    expect(await session.unlockSession()).toBe(true);
    const { registerNotifications } = await import("../src/notifications");

    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body), { status: 200 });
    });

    permissionStatus = "denied";
    expect(await registerNotifications()).toMatchObject({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      platform: "android",
      pushState: "denied",
      preferences: { inApp: true, push: false },
    });

    permissionStatus = "granted";
    easProjectId = undefined;
    expect(await registerNotifications()).toMatchObject({
      pushState: "unavailable",
      preferences: { inApp: true, push: false },
    });

    vi.resetModules();
    easProjectId = "eas-project-123";
    const session2 = await import("../src/session");
    expect(await session2.unlockSession()).toBe(true);
    const { registerNotifications: registerWithProject } = await import(
      "../src/notifications"
    );
    expect(await registerWithProject()).toMatchObject({
      pushState: "registered",
      pushToken: "ExponentPushToken[fixture-token]",
      preferences: { inApp: true, push: true },
    });

    pushTokenThrows = true;
    expect(await registerWithProject()).toMatchObject({
      pushState: "invalid",
      preferences: { inApp: true, push: false },
    });
  });
});

describe("mobile Android MWA wallet connection and exact-draft signing", () => {
  let platformOS: "android" | "ios" = "android";
  let walletSigner = Keypair.generate();
  let mutateSignedTx: ((tx: Transaction) => void) | null = null;
  const signAndSendSpy = vi.fn();

  beforeEach(() => {
    platformOS = "android";
    walletSigner = Keypair.generate();
    mutateSignedTx = null;
    signAndSendSpy.mockReset();

    vi.resetModules();
    vi.stubGlobal("__DEV__", false);
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://agus.fixture.invalid");

    vi.doMock("react-native", () => ({
      Platform: {
        get OS() {
          return platformOS;
        },
      },
    }));
    vi.doMock("expo-secure-store", () => ({
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
      getItem: () => null,
      getItemAsync: async () => null,
      setItem: () => {},
      setItemAsync: async () => {},
      deleteItemAsync: async () => {},
    }));
    vi.doMock("expo-local-authentication", () => ({
      hasHardwareAsync: async () => false,
      isEnrolledAsync: async () => false,
      authenticateAsync: async () => ({ success: false }),
    }));
    vi.doMock("better-auth/react", () => ({ createAuthClient: () => ({}) }));
    vi.doMock("better-auth/client/plugins", () => ({ twoFactorClient: () => ({}) }));
    vi.doMock("@better-auth/expo/client", () => ({ expoClient: () => ({}) }));
    vi.doMock("@solana-mobile/mobile-wallet-adapter-protocol-web3js", () => ({
      transact: async (fn: (wallet: unknown) => Promise<unknown>) =>
        fn({
          authorize: async () => ({
            accounts: [
              { address: encodeBase64(walletSigner.publicKey.toBytes()) },
            ],
            auth_token: "fixture-mwa-token",
            wallet_uri_base: "https://wallet.fixture.invalid",
          }),
          signTransactions: async ({
            transactions,
          }: {
            transactions: Transaction[];
          }) =>
            transactions.map((tx) => {
              tx.sign(walletSigner);
              mutateSignedTx?.(tx);
              return tx;
            }),
          signAndSendTransactions: signAndSendSpy,
        }),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("react-native");
    vi.doUnmock("expo-secure-store");
    vi.doUnmock("expo-local-authentication");
    vi.doUnmock("better-auth/react");
    vi.doUnmock("better-auth/client/plugins");
    vi.doUnmock("@better-auth/expo/client");
    vi.doUnmock("@solana-mobile/mobile-wallet-adapter-protocol-web3js");
  });

  function makeDraft(senderKey: Keypair, overrides: Partial<DevnetDraft> = {}): DevnetDraft {
    const recipient = Keypair.generate().publicKey;
    const tx = new Transaction({
      feePayer: senderKey.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(
      SystemProgram.transfer({
        fromPubkey: senderKey.publicKey,
        toPubkey: recipient,
        lamports: 1_000_000n,
      }),
    );
    const message = tx.serializeMessage();
    const unsigned = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    return {
      id: crypto.randomUUID(),
      revision: 1,
      network: "devnet",
      state: "approved",
      sender: senderKey.publicKey.toBase58(),
      recipient: recipient.toBase58(),
      asset: "SOL",
      mint: null,
      decimals: 9,
      amount: { atoms: "1000000", currency: "SOL", scale: 9 },
      displayAmount: "0.001",
      amountAtoms: "1000000",
      digest: "a".repeat(64),
      unsignedTransactionBase64: encodeBase64(unsigned),
      messageBase64: encodeBase64(message),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      feeLamports: "5000",
      estimatedRentLamports: "0",
      simulation: { passed: true },
      submission: null,
      ...overrides,
    };
  }

  it("connects Android Devnet wallet and rejects non-Android platforms", async () => {
    const { connectAndroidWallet } = await import("../src/wallet");
    expect(await connectAndroidWallet()).toBe(walletSigner.publicKey.toBase58());

    platformOS = "ios";
    await expect(connectAndroidWallet()).rejects.toThrow("ANDROID_WALLET_REQUIRED");
  });

  it("signs exact approved Devnet transaction via MWA signTransactions (never signAndSend) and rejects mismatches/expiry", async () => {
    const { signExactDraft } = await import("../src/wallet");
    const valid = makeDraft(walletSigner);

    const signedBase64 = await signExactDraft(valid);
    expect(signAndSendSpy).not.toHaveBeenCalled();
    const parsed = Transaction.from(decodeBase64(signedBase64));
    expect(parsed.verifySignatures()).toBe(true);
    expect(encodeBase64(parsed.serializeMessage())).toBe(valid.messageBase64);

    await expect(
      signExactDraft(makeDraft(walletSigner, { state: "prepared" })),
    ).rejects.toThrow("EXACT_FRESH_APPROVAL_REQUIRED");
    await expect(
      signExactDraft(makeDraft(walletSigner, { simulation: undefined })),
    ).rejects.toThrow("EXACT_FRESH_APPROVAL_REQUIRED");
    await expect(
      signExactDraft(
        makeDraft(walletSigner, {
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      ),
    ).rejects.toThrow("EXACT_FRESH_APPROVAL_REQUIRED");

    const other = Keypair.generate();
    await expect(
      signExactDraft(makeDraft(other)),
    ).rejects.toThrow("WALLET_ACCOUNT_CHANGED");

    await expect(
      signExactDraft(
        makeDraft(walletSigner, {
          messageBase64: btoa("tampered"),
        }),
      ),
    ).rejects.toThrow("DRAFT_MESSAGE_MISMATCH");

    mutateSignedTx = (tx) => {
      tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
    };
    await expect(signExactDraft(valid)).rejects.toThrow("WALLET_SIGNATURE_MISMATCH");
  });
});
