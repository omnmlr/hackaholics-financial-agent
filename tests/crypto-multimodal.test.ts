import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { base58 } from "@scure/base";
import { Keypair } from "@solana/web3.js";
import sharp from "sharp";
import QRCode from "qrcode";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET, POST } from "../src/app/api/v1/crypto/[[...path]]/route";
import * as gemini from "../src/lib/model-led-agent/model";
import { checkCryptoImage } from "../src/server/crypto/assistant-image";
import { containsWalletSecret } from "../src/server/crypto/sensitive";
import { sharedPlatform } from "./helpers/shared-platform";

const liveKey = process.env.AI_API_KEY;
const realProviders = process.env.AGUS_CRYPTO_LIVE_MULTIMODAL === "true";
const ocrAvailable =
  spawnSync("tesseract", ["--list-langs"], {
    encoding: "utf8",
  }).stdout?.includes("eng") ?? false;
// Published BIP39 checksum vector. It has never been a wallet in this suite.
const testMnemonic = `${"abandon ".repeat(11)}about`;
const routePlan = {
  tool: "clarify",
  flow: "all",
  asset: "all",
  days: 7,
  walletLabel: null,
};

function modelResult(text: string) {
  return { text, content: { role: "model", parts: [{ text }] }, calls: [] };
}

async function visualFixture() {
  return sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="380">
    <rect width="640" height="380" fill="#fff" />
    <path d="M40 30v310h550" fill="none" stroke="#ddd" stroke-width="3" />
    <path d="M55 300L195 235L320 244L460 103L580 66" fill="none" stroke="#c00000" stroke-width="8" />
    <path d="M55 60L195 107L320 131L460 215L580 275" fill="none" stroke="#0033cc" stroke-width="8" />
  </svg>`),
  )
    .png()
    .toBuffer();
}

describe("Crypto assistant credential screening", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("detects seed phrases and actual keypairs without blocking public Solana signatures", () => {
    const keypair = Keypair.generate();
    expect(
      containsWalletSecret(`Here is my information: ${testMnemonic}`),
    ).toBe(true);
    expect(containsWalletSecret(base58.encode(keypair.secretKey))).toBe(true);
    expect(
      containsWalletSecret(Buffer.from(keypair.secretKey).toString("base64")),
    ).toBe(true);
    expect(containsWalletSecret(JSON.stringify([...keypair.secretKey]))).toBe(
      true,
    );
    expect(containsWalletSecret(keypair.publicKey.toBase58())).toBe(false);
    expect(containsWalletSecret(base58.encode(Buffer.alloc(64, 42)))).toBe(
      false,
    );
    expect(
      containsWalletSecret("How do I keep my recovery phrase private?"),
    ).toBe(false);
  });

  it.skipIf(!ocrAvailable)(
    "rejects MIME confusion, excess bytes and credentials in PNG text or QR codes before Gemini",
    async () => {
      vi.stubEnv("AGUS_CRYPTO_IMAGES", "true");
      const signal = AbortSignal.timeout(10_000);
      const valid = await visualFixture();
      await expect(
        checkCryptoImage(valid, "image/jpeg", signal),
      ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
      await expect(
        checkCryptoImage(
          Buffer.alloc(5 * 1024 * 1024 + 1),
          "image/png",
          signal,
        ),
      ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
      const mnemonicImage = await sharp(
        Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="150">
      <rect width="1600" height="150" fill="white"/>
      <text x="20" y="55" font-family="DejaVu Sans" font-size="35">${testMnemonic.split(" ").slice(0, 6).join(" ")}</text>
      <text x="20" y="115" font-family="DejaVu Sans" font-size="35">${testMnemonic.split(" ").slice(6).join(" ")}</text>
    </svg>`),
      )
        .png()
        .toBuffer();
      await expect(
        checkCryptoImage(mnemonicImage, "image/png", signal),
      ).rejects.toMatchObject({ code: "SENSITIVE_CONTENT" });
      await expect(
        checkCryptoImage(
          await QRCode.toBuffer(testMnemonic),
          "image/png",
          signal,
        ),
      ).rejects.toMatchObject({ code: "SENSITIVE_CONTENT" });
    },
  );
});

describe.skipIf(!process.env.AGUS_TEST_DATABASE_URL)(
  "Authenticated unified Crypto assistant",
  () => {
    let fixture: Awaited<ReturnType<typeof sharedPlatform>>;
    const origin = "http://localhost:3000";

    beforeAll(async () => {
      fixture = await sharedPlatform(2);
    }, 30_000);
    afterAll(async () => {
      await fixture?.close();
    });
    afterEach(() => vi.restoreAllMocks());

    const ask = (
      text: string,
      inputMode: "text" | "voice" = "text",
      conversationId?: string,
    ) => ({
      text,
      inputMode,
      conversationId,
      clientTurnId: randomUUID(),
      scope: { cluster: "devnet" },
      reportingTimeZone: "UTC",
    });

    function request(
      path: string,
      owner: number | null,
      payload?: ReturnType<typeof ask> | FormData,
      key = randomUUID(),
    ) {
      const headers = new Headers({ origin, "idempotency-key": key });
      if (owner !== null) headers.set("cookie", fixture.users[owner].cookie);
      if (payload && !(payload instanceof FormData))
        headers.set("content-type", "application/json");
      return new Request(`${origin}/api/v1/crypto/assistant/${path}`, {
        method: payload ? "POST" : "GET",
        headers,
        body:
          payload instanceof FormData
            ? payload
            : payload && JSON.stringify(payload),
      });
    }

    function withImage(turn: ReturnType<typeof ask>, bytes: Buffer) {
      const form = new FormData();
      form.set("turn", JSON.stringify(turn));
      form.set(
        "image",
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        "observations.png",
      );
      return form;
    }

    it("recovers the same turn after disconnect, checks tenant scope and handles sensitive text before inference", async () => {
      vi.stubEnv("AI_PROVIDER", "gemini");
      vi.stubEnv("AI_API_KEY", "fixture-gemini");
      const ready = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<ReturnType<typeof modelResult>>();
      const generate = vi.fn(() => {
        ready.resolve();
        return finish.promise;
      });
      vi.spyOn(gemini, "createGeminiToolModel").mockReturnValue({
        provider: "gemini",
        model: "fixture",
        generate,
      });
      const sensitive = await POST(request("turns", 0, ask(testMnemonic)));
      expect(sensitive.status).toBe(422);
      expect(generate).not.toHaveBeenCalled();
      const turn = ask("Which transfer should I review?");
      const key = randomUUID();
      const pending = POST(request("turns", 0, turn, key));
      await ready.promise;
      const processing = await GET(request(`turns/${turn.clientTurnId}`, 0));
      expect(await processing.json()).toMatchObject({ state: "processing" });
      expect((await GET(request(`turns/${turn.clientTurnId}`, 1))).status).toBe(
        404,
      );
      expect(
        (await GET(request(`turns/${turn.clientTurnId}`, null))).status,
      ).toBe(401);
      expect(
        (
          await POST(
            request("turns", 0, { ...turn, text: "Different question" }, key),
          )
        ).status,
      ).toBe(409);
      finish.resolve(modelResult(JSON.stringify(routePlan)));
      const completed = await (await pending).json();
      expect(completed.input).toEqual({ mode: "text", image: false });
      expect(await (await POST(request("turns", 0, turn, key))).json()).toEqual(
        completed,
      );
      expect(
        await (await GET(request(`turns/${turn.clientTurnId}`, 0))).json(),
      ).toMatchObject({ state: "completed", answer: completed });
      expect(
        (await GET(request(`conversations/${completed.conversationId}`, 1)))
          .status,
      ).toBe(404);
      expect(generate).toHaveBeenCalledTimes(1);
    });

    it.skipIf(!ocrAvailable)(
      "keeps voice and image evidence in the same scoped conversation and withholds image-based transfer suggestions",
      async () => {
        vi.stubEnv("AI_PROVIDER", "gemini");
        vi.stubEnv("AI_API_KEY", "fixture-gemini");
        vi.stubEnv("AGUS_CRYPTO_IMAGES", "true");
        const visual = {
          summary: "The lines trend in opposite directions.",
          observations: ["The red line rises.", "The blue line falls."],
          signature: null,
        };
        const generate = vi.fn(
          async (input: Parameters<gemini.ToolModel["generate"]>[0]) => {
            expect(input.declarations).toEqual([]);
            if (input.contents[0].parts?.some((part) => part.inlineData))
              return modelResult(JSON.stringify(visual));
            const text = input.contents[0].parts?.[0].text ?? "";
            if (input.system.includes("Classify"))
              return modelResult(
                JSON.stringify({
                  ...routePlan,
                  ...(text.includes("Send")
                    ? { tool: "eligibility" }
                    : { followUp: true }),
                }),
              );
            expect(text).toContain("The red line rises.");
            return modelResult("The red line rose from left to right.");
          },
        );
        vi.spyOn(gemini, "createGeminiToolModel").mockReturnValue({
          provider: "gemini",
          model: "fixture",
          generate,
        });
        const recipient = Keypair.generate().publicKey.toBase58();
        const image = await visualFixture();
        const response = await POST(
          request(
            "turns",
            0,
            withImage(ask(`Send 0.001 SOL to ${recipient}`, "voice"), image),
          ),
        );
        expect(response.status).toBe(200);
        const attached = await response.json();
        expect(attached).toMatchObject({
          kind: "clarify",
          image: visual,
          input: { mode: "voice", image: true },
          suggestion: null,
        });
        const followUp = await (
          await POST(
            request(
              "turns",
              0,
              ask(
                "What did the red line do in that screenshot?",
                "text",
                attached.conversationId,
              ),
            ),
          )
        ).json();
        expect(followUp).toMatchObject({
          text: "The red line rose from left to right.",
          conversationId: attached.conversationId,
          input: { mode: "text", image: false },
          suggestion: null,
        });
        const thread = await (
          await GET(request(`conversations/${attached.conversationId}`, 0))
        ).json();
        expect(thread.turns).toEqual([attached, followUp]);
        expect(thread.processing).toBeNull();
        expect(JSON.stringify(thread)).not.toContain(
          image.toString("base64").slice(0, 80),
        );
      },
      20_000,
    );

    it.skipIf(!realProviders || !liveKey || !ocrAvailable)(
      "uses actual Gemini pixels through the authenticated attachment API",
      async () => {
        vi.stubEnv("AI_PROVIDER", "gemini");
        vi.stubEnv("AI_API_KEY", liveKey);
        vi.stubEnv("AGUS_CRYPTO_IMAGES", "true");
        const response = await POST(
          request(
            "turns",
            0,
            withImage(
              ask(
                "What direction do the two colored lines trend from left to right?",
                "voice",
              ),
              await sharp(await visualFixture())
                .resize({ width: 320 })
                .png()
                .toBuffer(),
            ),
          ),
        );
        expect(response.status).toBe(200);
        const attached = await response.json();
        expect(attached.image).not.toBeNull();
        const visualText = JSON.stringify(attached.image).toLowerCase();
        expect(visualText).toMatch(/red/);
        expect(visualText).toMatch(/blue/);
        expect(visualText).toMatch(
          /ris|increas|upward|ascend|bottom.left|lower.left/,
        );
        expect(visualText).toMatch(
          /fall|decreas|downward|declin|descend|top.left|upper.left/,
        );
        console.log(JSON.stringify({ liveVisual: attached.image }));
      },
      45_000,
    );

    it.skipIf(!realProviders || !liveKey || !process.env.FIRECRAWL_API_KEY)(
      "uses Firecrawl through the authenticated turn API",
      async () => {
        vi.stubEnv("AI_PROVIDER", "gemini");
        vi.stubEnv("AI_API_KEY", liveKey);
        const research = await (
          await POST(
            request(
              "turns",
              0,
              ask(
                "Research the official Solana transaction fees documentation at https://solana.com/docs/core/fees",
              ),
            ),
          )
        ).json();
        expect(research.citations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              url: "https://solana.com/docs/core/fees",
            }),
          ]),
        );
        console.log(
          JSON.stringify({
            liveResearch: {
              text: research.text,
              citations: research.citations,
            },
          }),
        );
      },
      75_000,
    );
  },
);
