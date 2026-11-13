import { describe, expect, it, beforeEach } from "vitest";
import {
  PollarService,
  defaultPollarService,
} from "../src/lib/pollar/service";
import {
  PollarPaymentAdapter,
  defaultPollarAdapter,
} from "../src/lib/pollar/adapter";
import {
  isValidStellarAddress,
  isIssuerAddress,
  toStellarAtoms,
  fromStellarAtoms,
  calculatePollarDraftDigest,
  stellarExplorerTxUrl,
  STELLAR_TESTNET_USDC_ISSUER,
  CONTROLLED_TEST_RECIPIENT_STELLAR,
  STELLAR_TESTNET_HORIZON,
} from "../src/lib/pollar/contracts";
import { PollarMemoryStore } from "../src/lib/pollar/store";

describe("Pollar SDK Web Integration — AGUS 2.0 (Final Security & On-Chain Verification)", () => {
  let testStore: PollarMemoryStore;
  let service: PollarService;
  let adapter: PollarPaymentAdapter;

  const validStellarSender = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2VRGVY2AMGAISMGW52J";
  // Controlled, genuine funded recipient on Stellar Testnet (NOT the Circle USDC issuer)
  const controlledRecipient = CONTROLLED_TEST_RECIPIENT_STELLAR;

  beforeEach(() => {
    testStore = new PollarMemoryStore();
    service = new PollarService({ apiKey: undefined, publishableKey: undefined }, testStore);
    adapter = new PollarPaymentAdapter(service);
  });

  describe("Critical Issue 1: Circle USDC Issuer vs Controlled Test Recipient Audit", () => {
    const userId = "agus_user_amina_42";

    it("verifies that Circle USDC issuer address is identified and differentiated", () => {
      expect(isIssuerAddress(STELLAR_TESTNET_USDC_ISSUER)).toBe(true);
      expect(isIssuerAddress(controlledRecipient)).toBe(false);
      expect(isIssuerAddress(validStellarSender)).toBe(false);
    });

    it("strictly blocks sending payments directly to Circle's USDC issuer address", async () => {
      await expect(
        adapter.prepareConversationalPayment(userId, {
          recipient: STELLAR_TESTNET_USDC_ISSUER,
          amount: "10.0",
          asset: "USDC",
        }),
      ).rejects.toThrow("INVALID_RECIPIENT_ISSUER");
    });

    it("allows payment preparation when sending to the controlled test recipient", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: controlledRecipient,
        amount: "10.0",
        asset: "USDC",
      });

      expect(draft.recipient).toBe(controlledRecipient);
      expect(draft.recipient).not.toBe(STELLAR_TESTNET_USDC_ISSUER);
      expect(review.recipient).toBe(controlledRecipient);
    });
  });

  describe("Critical Issue 2: Server-Side Owner Re-Authentication Invariant", () => {
    const userId = "agus_user_amina_42";

    it("strictly rejects arbitrary boolean approval bypass attempt", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: controlledRecipient,
        amount: "10.00",
        asset: "USDC",
      });

      // Attempting to pass a boolean as the legacy 4th parameter must throw
      await expect(
        (service as any).authorizePayment(userId, draft.id, { digest: review.digest }, true),
      ).rejects.toThrow("BOOLEAN_AUTHORIZATION_DISALLOWED");
    });

    it("strictly rejects authorization when password is empty or missing", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: controlledRecipient,
        amount: "10.00",
        asset: "USDC",
      });

      // Missing password in auth request
      await expect(
        service.authorizePayment(userId, draft.id, { digest: review.digest }),
      ).rejects.toThrow("PASSWORD_REAUTHENTICATION_REQUIRED");

      // Empty password string
      await expect(
        service.authorizePayment(userId, draft.id, { digest: review.digest, password: "" }),
      ).rejects.toThrow("PASSWORD_REAUTHENTICATION_REQUIRED");

      // Whitespace only password
      await expect(
        service.authorizePayment(userId, draft.id, { digest: review.digest, password: "   " }),
      ).rejects.toThrow("PASSWORD_REAUTHENTICATION_REQUIRED");
    });

    it("rejects authorization when server re-authenticator fails (incorrect password)", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: controlledRecipient,
        amount: "10.00",
        asset: "USDC",
      });

      const failingReauthenticator = async (_owner: string, _password: string) => {
        throw new Error("401 Incorrect password attempt budget exhausted");
      };

      await expect(
        service.authorizePayment(userId, draft.id, {
          digest: review.digest,
          password: "wrong_password",
          reauthenticator: failingReauthenticator,
        }),
      ).rejects.toThrow("401 Incorrect password");

      // Verify draft state remains prepared, not approved
      const unapprovedDraft = await testStore.getDraft(draft.id);
      expect(unapprovedDraft?.state).toBe("prepared");
    });

    it("rejects authorization when terms have been tampered with (digest mismatch)", async () => {
      const { draft } = await adapter.prepareConversationalPayment(userId, {
        recipient: controlledRecipient,
        amount: "10.00",
        asset: "USDC",
      });

      await expect(
        service.authorizePayment(userId, draft.id, {
          digest: "tampered_digest_00000000000000000000000000000000000000000000000000000000",
          password: "valid_owner_password",
        }),
      ).rejects.toThrow("DIGEST_MISMATCH");
    });

    it("approves draft when valid password and matching digest are provided", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: controlledRecipient,
        amount: "10.00",
        asset: "USDC",
      });

      let reauthCalled = false;
      const validReauthenticator = async (owner: string, password: string) => {
        if (owner === userId && password === "correct_secret_passphrase") {
          reauthCalled = true;
          return;
        }
        throw new Error("Reauthentication failed");
      };

      const approved = await service.authorizePayment(userId, draft.id, {
        digest: review.digest,
        password: "correct_secret_passphrase",
        reauthenticator: validReauthenticator,
      });

      expect(approved.state).toBe("approved");
      expect(approved.approval?.actor).toBe(userId);
      expect(approved.approval?.digest).toBe(review.digest);
      expect(reauthCalled).toBe(true);
    });
  });

  describe("Critical Issue 3: Genuine Pollar SDK Execution vs Sandbox Delineation", () => {
    const userId = "agus_user_amina_42";

    it("clearly classifies fallback execution as 'testnet-sandbox-fallback' when API key is missing", async () => {
      const uncredentialedService = new PollarService({ apiKey: undefined, publishableKey: undefined }, testStore);
      const uncredentialedAdapter = new PollarPaymentAdapter(uncredentialedService);

      const { draft, review } = await uncredentialedAdapter.prepareConversationalPayment(userId, {
        recipient: controlledRecipient,
        amount: "5.00",
        asset: "USDC",
      });

      const result = await uncredentialedAdapter.authorizeAndExecute(userId, draft.id, {
        digest: review.digest,
        password: "valid_demo_password",
      });

      expect(result.success).toBe(true);
      expect(result.executionMode).toBe("testnet-sandbox-fallback");
      expect(result.evidence.liveNetworkSubmitted).toBe(false);
      expect(result.evidence.verificationSource).toBe("sandbox-simulation");
      expect(result.evidence.details).toContain("POLLAR_API_KEY is not configured");
      expect(result.receipt?.verified).toBe(false);
      expect(result.receipt?.executionMode).toBe("testnet-sandbox-fallback");
    });

    it("distinguishes fake/sandbox transaction hash from genuine ledger records during settlement check", async () => {
      const fakeTxHash = "0000000000000000000000000000000000000000000000000000000000000000";
      const settlement = await adapter.verifyPayment(fakeTxHash, "STELLAR");

      // A fake hash cannot be confirmed on Stellar Horizon
      expect(settlement.verified).toBe(false);
      expect(settlement.status).toBe("NOT_FOUND");
    });

    it("verifies genuine on-chain transaction evidence against live Stellar Testnet Horizon", async () => {
      // Genuine live transaction hash that created the controlled recipient on Stellar Testnet
      const genuineLiveTxHash = "9a06fa5ed4e8a4ac1e7e2d71240a884488d7bcd1f07f7d29034933a7b68f21c5";

      const settlement = await adapter.verifyPayment(genuineLiveTxHash, "STELLAR");

      expect(settlement.verified).toBe(true);
      expect(settlement.status).toBe("CONFIRMED");
      expect(settlement.ledgerSequence).toBe(5711803);
      expect(settlement.confirmedAt).toBe("2026-11-13T15:10:59Z");
      expect(settlement.explorerUrl).toContain(genuineLiveTxHash);
    });

    it("verifies controlled recipient live on-chain balance on Stellar Testnet", async () => {
      const res = await fetch(`${STELLAR_TESTNET_HORIZON}/accounts/${controlledRecipient}`);
      expect(res.status).toBe(200);

      const accountData = await res.json();
      expect(accountData.id).toBe(controlledRecipient);
      expect(accountData.balances.some((b: any) => b.asset_type === "native" && parseFloat(b.balance) > 0)).toBe(true);
    });
  });

  describe("Phase 1: General SDK Contracts & Precision Checks", () => {
    it("reports missing credentials blocker when API keys are absent", () => {
      const uncredentialedService = new PollarService({ apiKey: "", publishableKey: "" }, testStore);
      const prereq = uncredentialedService.checkPrerequisites();

      expect(prereq.viable).toBe(false);
      expect(prereq.blocker).toBeDefined();
      expect(prereq.blocker?.code).toBe("POLLAR_CREDENTIALS_MISSING");
      expect(prereq.blocker?.category).toBe("MISSING_CREDENTIALS");
      expect(prereq.blocker?.technicalDetails).toContain("dashboard.pollar.xyz");
    });

    it("initializes official PollarClient when API key is provided", () => {
      const credentialedService = new PollarService({
        apiKey: "pk_testnet_sample_mock_api_key_for_testing",
        publishableKey: "pub_testnet_sample_publishable_key",
        baseUrl: "https://sdk.api.pollar.xyz",
        stellarNetwork: "testnet",
      }, testStore);

      const prereq = credentialedService.checkPrerequisites();
      expect(prereq.viable).toBe(true);

      const pollarClient = credentialedService.getPollarClient();
      expect(pollarClient).not.toBeNull();
      expect(typeof pollarClient?.sendPayment).toBe("function");
      expect(typeof pollarClient?.getWalletBalance).toBe("function");
    });

    it("verifies Stellar address validation rules", () => {
      expect(isValidStellarAddress(validStellarSender)).toBe(true);
      expect(isValidStellarAddress(controlledRecipient)).toBe(true);
      expect(isValidStellarAddress("")).toBe(false);
      expect(isValidStellarAddress("12345")).toBe(false);
      expect(isValidStellarAddress("0x71C...ethereum")).toBe(false);
      expect(isValidStellarAddress("GA_invalid_characters_!!!!")).toBe(false);
      expect(isValidStellarAddress("BA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2VRGVY2AMGAISMGW52J")).toBe(false);
    });

    it("accurately converts fixed-point atomic units for Stellar USDC", () => {
      expect(toStellarAtoms("10.5", 7)).toBe("105000000");
      expect(toStellarAtoms("0.0000001", 7)).toBe("1");
      expect(toStellarAtoms("100", 7)).toBe("1000000000");
      expect(fromStellarAtoms("105000000", 7)).toBe("10.5");
      expect(fromStellarAtoms("1", 7)).toBe("0.0000001");
    });
  });

  describe("Phase 2 & 3: Idempotency & Metadata Checks", () => {
    const userId = "agus_user_amina_42";

    it("enforces idempotency against duplicate payment submissions", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: controlledRecipient,
        amount: "5.00",
        asset: "USDC",
      });

      const firstResult = await adapter.authorizeAndExecute(userId, draft.id, {
        digest: review.digest,
        password: "owner_password",
      });
      expect(firstResult.success).toBe(true);

      const duplicateResult = await service.submitPayment(userId, draft.id);
      expect(duplicateResult.success).toBe(true);
      expect(duplicateResult.transactionHash).toBe(firstResult.transactionHash);
    });

    it("exposes complete adapter metadata for Codex integration", () => {
      const meta = adapter.getMetadata();

      expect(meta.providerId).toBe("pollar");
      expect(meta.version).toBe("0.12.0");
      expect(meta.primaryNetwork).toBe("stellar-testnet");
      expect(meta.features.gaslessOrSponsored).toBe(true);
      expect(meta.features.conversationalApproval).toBe(true);
      expect(meta.supportedAssets.some((a) => a.code === "USDC" && a.chain === "STELLAR")).toBe(true);
    });
  });
});
