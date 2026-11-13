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
  toStellarAtoms,
  fromStellarAtoms,
  calculatePollarDraftDigest,
  stellarExplorerTxUrl,
  STELLAR_TESTNET_USDC_ISSUER,
  STELLAR_TESTNET_HORIZON,
} from "../src/lib/pollar/contracts";
import { PollarMemoryStore } from "../src/lib/pollar/store";

describe("Pollar SDK Web Integration — AGUS 2.0", () => {
  let testStore: PollarMemoryStore;
  let service: PollarService;
  let adapter: PollarPaymentAdapter;

  // Known valid Stellar testnet public keys (56 characters starting with G)
  const validStellarSender = "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2VRGVY2AMGAISMGW52J";
  const validStellarRecipient = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  beforeEach(() => {
    testStore = new PollarMemoryStore();
    service = new PollarService({ apiKey: undefined, publishableKey: undefined }, testStore);
    adapter = new PollarPaymentAdapter(service);
  });

  describe("Phase 1: SDK Truth & Prerequisite Checks", () => {
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
      expect(isValidStellarAddress(validStellarRecipient)).toBe(true);
      // Invalid addresses
      expect(isValidStellarAddress("")).toBe(false);
      expect(isValidStellarAddress("12345")).toBe(false);
      expect(isValidStellarAddress("0x71C...ethereum")).toBe(false);
      expect(isValidStellarAddress("GA_invalid_characters_!!!!")).toBe(false);
      expect(isValidStellarAddress("BA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2VRGVY2AMGAISMGW52J")).toBe(false); // Does not start with G
    });

    it("accurately converts fixed-point atomic units for Stellar USDC", () => {
      expect(toStellarAtoms("10.5", 7)).toBe("105000000");
      expect(toStellarAtoms("0.0000001", 7)).toBe("1");
      expect(toStellarAtoms("100", 7)).toBe("1000000000");
      expect(fromStellarAtoms("105000000", 7)).toBe("10.5");
      expect(fromStellarAtoms("1", 7)).toBe("0.0000001");
    });
  });

  describe("Phase 2 & 3: Functional Integration & AGUS Adapter", () => {
    const userId = "agus_user_amina_42";

    it("provisions and caches a deterministic Stellar wallet session for an AGUS user", async () => {
      const session = await adapter.getWalletSession(userId);

      expect(session).toBeDefined();
      expect(session.userId).toBe(userId);
      expect(session.chain).toBe("STELLAR");
      expect(session.network).toBe("testnet");
      expect(session.provisioning).toBe("READY");
      expect(isValidStellarAddress(session.address)).toBe(true);

      // Subsequent call retrieves the same cached session
      const secondCall = await adapter.getWalletSession(userId);
      expect(secondCall.address).toBe(session.address);
      expect(secondCall.clientSessionId).toBe(session.clientSessionId);
    });

    it("retrieves asset balances including testnet USDC and XLM", async () => {
      const balances = await adapter.getBalances(userId, "STELLAR");

      expect(balances.length).toBeGreaterThanOrEqual(2);
      const usdc = balances.find((b) => b.asset === "USDC");
      const xlm = balances.find((b) => b.asset === "XLM");

      expect(usdc).toBeDefined();
      expect(usdc?.chain).toBe("STELLAR");
      expect(usdc?.issuer).toBe(STELLAR_TESTNET_USDC_ISSUER);
      expect(parseFloat(usdc?.available ?? "0")).toBeGreaterThan(0);

      expect(xlm).toBeDefined();
      expect(xlm?.chain).toBe("STELLAR");
      expect(xlm?.decimals).toBe(7);
    });

    it("rejects payment preparation with an invalid recipient address", async () => {
      await expect(
        adapter.prepareConversationalPayment(userId, {
          recipient: "invalid_stellar_address_format",
          amount: "10.0",
          asset: "USDC",
        }),
      ).rejects.toThrow("INVALID_STELLAR_RECIPIENT");
    });

    it("rejects payment preparation with non-positive or invalid amounts", async () => {
      await expect(
        adapter.prepareConversationalPayment(userId, {
          recipient: validStellarRecipient,
          amount: "-5.0",
          asset: "USDC",
        }),
      ).rejects.toThrow("INVALID_AMOUNT");

      await expect(
        adapter.prepareConversationalPayment(userId, {
          recipient: validStellarRecipient,
          amount: "not_a_number",
          asset: "USDC",
        }),
      ).rejects.toThrow("INVALID_AMOUNT");

      await expect(
        adapter.prepareConversationalPayment(userId, {
          recipient: validStellarRecipient,
          amount: "10.123456789", // 9 decimal places exceeds Stellar max 7
          asset: "USDC",
        }),
      ).rejects.toThrow("EXCESSIVE_PRECISION");
    });

    it("rejects payment preparation when amount exceeds available balance", async () => {
      await expect(
        adapter.prepareConversationalPayment(userId, {
          recipient: validStellarRecipient,
          amount: "999999.00", // Way above testnet balance
          asset: "USDC",
        }),
      ).rejects.toThrow("INSUFFICIENT_BALANCE");
    });

    it("prepares payment draft and produces exact conversational review payload", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: validStellarRecipient,
        amount: "10.00",
        asset: "USDC",
        memo: "AGUS payment test",
      });

      expect(draft.id).toMatch(/^pollar_draft_/);
      expect(draft.state).toBe("prepared");
      expect(draft.amount).toBe("10.00");
      expect(draft.asset).toBe("USDC");
      expect(draft.chain).toBe("STELLAR");
      expect(draft.fee.sponsored).toBe(true);

      // Review payload validation
      expect(review.draftId).toBe(draft.id);
      expect(review.amount).toBe("10.00");
      expect(review.asset).toBe("USDC");
      expect(review.networkDisplay).toBe("Stellar Testnet");
      expect(review.feeDisplay).toContain("Sponsored by Pollar");
      expect(review.digest).toBe(draft.digest);
      expect(review.requiresPasswordReauth).toBe(true);
    });

    it("enforces exact cryptographic digest binding and owner check on authorization", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: validStellarRecipient,
        amount: "15.00",
        asset: "USDC",
      });

      // Wrong owner fails
      await expect(
        service.authorizePayment("wrong_user_bob", draft.id, review.digest, true),
      ).rejects.toThrow("UNAUTHORIZED_ACTOR");

      // Tampered digest fails
      await expect(
        service.authorizePayment(userId, draft.id, "tampered_digest_abc123", true),
      ).rejects.toThrow("DIGEST_MISMATCH");

      // Password unverified fails
      await expect(
        service.authorizePayment(userId, draft.id, review.digest, false),
      ).rejects.toThrow("AUTHORIZATION_DECLINED");

      // Correct authorization succeeds
      const approvedDraft = await service.authorizePayment(userId, draft.id, review.digest, true);
      expect(approvedDraft.state).toBe("approved");
      expect(approvedDraft.approval?.actor).toBe(userId);
      expect(approvedDraft.approval?.digest).toBe(review.digest);
    });

    it("executes end-to-end authorized payment with settlement receipt", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: validStellarRecipient,
        amount: "10.00",
        asset: "USDC",
      });

      const result = await adapter.authorizeAndExecute(userId, draft.id, review.digest, true);

      expect(result.success).toBe(true);
      expect(result.status).toBe("SUCCESS");
      expect(result.chain).toBe("STELLAR");
      expect(result.transactionHash).toBeDefined();
      expect(result.explorerUrl).toBe(stellarExplorerTxUrl(result.transactionHash));
      expect(result.receipt).toBeDefined();
      expect(result.receipt?.amount).toBe("10.00");
      expect(result.receipt?.asset).toBe("USDC");
      expect(result.receipt?.verified).toBe(true);

      // Verify draft state in store is now confirmed
      const updatedDraft = await testStore.getDraft(draft.id);
      expect(updatedDraft?.state).toBe("confirmed");
      expect(updatedDraft?.settlement?.hash).toBe(result.transactionHash);
    });

    it("enforces idempotency against duplicate payment submissions", async () => {
      const { draft, review } = await adapter.prepareConversationalPayment(userId, {
        recipient: validStellarRecipient,
        amount: "5.00",
        asset: "USDC",
      });

      // First execution succeeds
      const firstResult = await adapter.authorizeAndExecute(userId, draft.id, review.digest, true);
      expect(firstResult.success).toBe(true);

      // Second submission of the same draft returns existing settlement idempotently
      const duplicateResult = await service.submitPayment(userId, draft.id);
      expect(duplicateResult.success).toBe(true);
      expect(duplicateResult.transactionHash).toBe(firstResult.transactionHash);
    });

    it("verifies settlement status query against explorer and ledger", async () => {
      const mockTxHash = "3389e9f0f73b654bb06079e6d4f79d6d88048cf7a97e1c5cf4710f6809a3f111";
      const settlement = await adapter.verifyPayment(mockTxHash, "STELLAR");

      expect(settlement.verified).toBe(true);
      expect(settlement.status).toBe("CONFIRMED");
      expect(settlement.explorerUrl).toContain(mockTxHash);
      expect(settlement.explorerUrl).toContain("stellar.expert/explorer/testnet/tx/");
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

  describe("Phase 6: Live Public Stellar Horizon Verification", () => {
    it("connects to public Stellar Horizon testnet and verifies network passphrase", async () => {
      const res = await fetch(STELLAR_TESTNET_HORIZON);
      expect(res.status).toBe(200);

      const horizonInfo = await res.json();
      expect(horizonInfo.network_passphrase).toBe("Test SDF Network ; September 2015");
    });
  });
});
