import { expect, it } from "vitest";
import {
  CIRCLE_DEVNET_USDC_MINT,
  devnetTokenLabel,
} from "../src/lib/solana/assets";
it("labels only the canonical mint with its verified decimal precision as Circle test USDC", () => {
  expect(devnetTokenLabel(CIRCLE_DEVNET_USDC_MINT, 6)).toBe(
    "Circle test USDC (Devnet; no cash value)",
  );
  expect(devnetTokenLabel(CIRCLE_DEVNET_USDC_MINT, 9)).toBe("token units");
  expect(
    devnetTokenLabel("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6),
  ).toBe("token units");
  expect(devnetTokenLabel("fixture-token-named-USDC", 6)).toBe("token units");
});
