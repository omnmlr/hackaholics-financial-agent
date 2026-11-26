import { describe, expect, it } from "vitest";
import { createApiClient } from "../packages/api-client/src";
import {
  createCryptoFixtureTransport,
  cryptoAssistantFixtureIds,
  cryptoFixtureScenarios,
} from "../packages/api-client/fixtures/crypto";
import {
  CryptoActivityPage,
  CryptoAddress,
  CryptoAnswer,
  CryptoConversation,
  CryptoPortfolio,
  CryptoTranscription,
  CryptoTurnStatus,
  CryptoWalletPage,
} from "../packages/contracts/src/crypto";

describe("AGUS Crypto generated client", () => {
  it.each(cryptoFixtureScenarios)(
    "validates the %s reads and atom totals",
    async (scenario) => {
      const api = createApiClient(
        "https://fixture.invalid",
        createCryptoFixtureTransport(scenario),
      );
      const params = { query: { cluster: "devnet" as const } };
      const wallets = CryptoWalletPage.parse(
        (await api.GET("/api/v1/crypto/wallets", { params })).data,
      );
      expect(wallets.items).toHaveLength(3);
      expect(wallets.items[0].routes).toHaveLength(2);
      const portfolio = CryptoPortfolio.parse(
        (await api.GET("/api/v1/crypto/portfolio", { params })).data,
      );
      const total = portfolio.holdings.reduce(
        (sum, holding) => sum + BigInt(holding.amount.atoms),
        0n,
      );
      expect(total).toBe(
        scenario === "outside_inflow_replay" ? 130_000_000n : 125_000_000n,
      );
      const activity = CryptoActivityPage.parse(
        (await api.GET("/api/v1/crypto/activity", { params })).data,
      );
      if (scenario === "internal_transfer")
        expect(
          activity.items.map(({ classification }) => classification),
        ).toEqual(["internal"]);
    },
  );
  it("rejects addresses that do not decode to 32 bytes", () => {
    expect(CryptoAddress.safeParse("1".repeat(33)).success).toBe(false);
  });

  it("uses the generated client for multimodal turns, recovery, and audio", async () => {
    const api = createApiClient(
      "https://fixture.invalid",
      createCryptoFixtureTransport("multimodal_assistant"),
    );
    const voice = await api.POST("/api/v1/crypto/assistant/transcriptions", {
      headers: { "Content-Type": "audio/aac" },
      body: new Blob([new Uint8Array([0xff, 0xf1])], { type: "audio/aac" }),
      bodySerializer: (recording) => recording,
    });
    const transcription = CryptoTranscription.parse(voice.data);
    const scope = { cluster: "devnet" as const };
    const clientTurnId = "4a95897a-d61c-4e20-a335-8ffc79f27963";
    const imageTurn = await api.POST("/api/v1/crypto/assistant/turns", {
      params: { header: { "Idempotency-Key": clientTurnId } },
      body: {
        turn: JSON.stringify({
          clientTurnId,
          inputMode: "voice",
          text: transcription.text,
          scope,
          reportingTimeZone: "Africa/Lagos",
        }),
        image: new Blob(["fixture image data"], { type: "image/png" }),
      },
      bodySerializer: (body) => {
        if (!("image" in body)) throw new Error("Expected an image turn");
        const form = new FormData();
        form.append("turn", body.turn);
        form.append("image", body.image, "receipt.png");
        return form;
      },
    });
    const image = CryptoAnswer.parse(imageTurn.data);
    expect(image.input).toEqual({ mode: "voice", image: true });
    expect(image.image?.observations).toHaveLength(1);
    expect(image.source.mode).toBe("fixture");
    expect(image.suggestion).toBeNull();
    const audio = await api.POST(
      "/api/v1/crypto/assistant/conversations/{id}/turns/{turnId}/audio",
      {
        params: { path: { id: image.conversationId, turnId: image.turnId } },
        parseAs: "stream",
      },
    );
    expect(audio.response.headers.get("content-type")).toBe("audio/mpeg");
    const reader = audio.data!.getReader();
    expect((await reader.read()).value).toMatchObject({ 0: 0xff, 1: 0xf3 });
    await reader.cancel();

    const followupId = "b5e09758-60b9-4e70-bbea-1b898682b2f2";
    const followup = await api.POST("/api/v1/crypto/assistant/turns", {
      params: { header: { "Idempotency-Key": followupId } },
      body: {
        clientTurnId: followupId,
        conversationId: image.conversationId,
        scope,
        text: "What fee did it pay?",
        reportingTimeZone: "Africa/Lagos",
      },
    });
    expect(CryptoAnswer.parse(followup.data).facts[0].atoms).toBe("5000");
    const researchId = "03655eaa-0a5e-4d4e-a88f-23d690c611b1";
    const research = await api.POST("/api/v1/crypto/assistant/turns", {
      params: { header: { "Idempotency-Key": researchId } },
      body: {
        clientTurnId: researchId,
        conversationId: image.conversationId,
        scope,
        text: "Research Solana network fees",
        reportingTimeZone: "Africa/Lagos",
      },
    });
    expect(CryptoAnswer.parse(research.data).citations?.[0].url).toBe(
      "https://solana.com/docs/core/fees",
    );
    const recovered = await api.GET(
      "/api/v1/crypto/assistant/turns/{clientTurnId}",
      {
        params: { path: { clientTurnId } },
      },
    );
    expect(CryptoTurnStatus.parse(recovered.data)).toEqual({
      state: "completed",
      conversationId: image.conversationId,
      turnId: image.turnId,
      answer: image,
    });
    const interrupted = await api.GET(
      "/api/v1/crypto/assistant/turns/{clientTurnId}",
      {
        params: {
          path: {
            clientTurnId: cryptoAssistantFixtureIds.interruptedClientTurnId,
          },
        },
      },
    );
    expect(CryptoTurnStatus.parse(interrupted.data).state).toBe("interrupted");
    const history = await api.GET(
      "/api/v1/crypto/assistant/conversations/{id}",
      {
        params: { path: { id: image.conversationId } },
      },
    );
    expect(CryptoConversation.parse(history.data).turns).toHaveLength(3);
    expect(CryptoConversation.parse(history.data).processing?.state).toBe(
      "processing",
    );
  });
});
