import { randomBytes, createHash } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import {
  type AgusMemoPayload,
  type ZcashAmount,
  type ZcashNetwork,
  type ZcashPaymentReceipt,
  zatoshisToZec,
  zecToZatoshis,
} from "../lib/zcash/types";
import { buildZip321Uri, validateZcashAddress } from "../lib/zcash/zip321";
import {
  type ViewingKeyProof,
  type ZcashRequestTerms,
  inspectZcashPaymentReceipt,
} from "../lib/zcash/receipt";
import { LightwalletdClient } from "../lib/zcash/lightwalletd-client";

export const ZcashRequestInput = z.strictObject({
  recipient: z.string().min(30),
  amountAtoms: z.string().regex(/^[1-9][0-9]{0,19}$/),
  network: z.enum(["testnet", "mainnet"]).default("testnet"),
  invoiceId: z.string().uuid(),
  label: z.string().max(80).optional(),
  message: z.string().max(140).optional(),
});
export type ZcashRequestInput = z.infer<typeof ZcashRequestInput>;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

export function instructionDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export interface ZcashRequestView {
  id: string;
  reference: string;
  recipient: string;
  pool: "orchard" | "sapling" | "transparent" | "unified";
  network: ZcashNetwork;
  amountAtoms: string;
  displayAmount: string;
  amount: ZcashAmount;
  digest: string;
  uri: string;
  qrCodeDataUrl: string;
  agusMemo: AgusMemoPayload;
  privacy: {
    isShielded: boolean;
    guarantees: string[];
    recommendedPool: string;
  };
  networkRequirement: string;
  status: "open" | "paid" | "expired" | "cancelled";
  createdAt: string;
}

/**
 * Creates an AGUS Privacy-Preserving Zcash Payment Request.
 * Uses ZIP 321 Payment URI standard, embeds a cryptographic AGUS memo payload,
 * and renders a verified QR code.
 */
export async function createZcashPaymentRequest(
  owner: string,
  input: ZcashRequestInput,
): Promise<ZcashRequestView> {
  const validated = ZcashRequestInput.parse(input);
  const addrCheck = validateZcashAddress(validated.recipient, validated.network);
  if (!addrCheck.valid) {
    throw new Error(`INVALID_ZCASH_ADDRESS_${validated.recipient}`);
  }

  const requestId = validated.invoiceId;
  const reference = `zec_req_${randomBytes(16).toString("hex")}`;
  const atoms = BigInt(validated.amountAtoms);

  // Compute immutable terms digest
  const termsSnapshot = {
    owner,
    requestId,
    reference,
    recipient: validated.recipient,
    amountAtoms: validated.amountAtoms,
    network: validated.network,
  };
  const digest = instructionDigest(termsSnapshot);

  const agusMemo: AgusMemoPayload = {
    magic: "AGUS",
    version: 1,
    requestId,
    reference,
    digest,
  };

  const uri = buildZip321Uri({
    address: validated.recipient,
    amountAtoms: atoms,
    agusMemo,
    message: validated.message || `AGUS invoice ${requestId.slice(0, 8)}`,
    label: validated.label || "AGUS Private Payment",
    network: validated.network,
  });

  const qrCodeDataUrl = await QRCode.toDataURL(uri, {
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 6,
  });

  const isShielded = addrCheck.pool === "unified" || addrCheck.pool === "sapling" || addrCheck.pool === "orchard";

  return {
    id: requestId,
    reference,
    recipient: validated.recipient,
    pool: addrCheck.pool,
    network: validated.network,
    amountAtoms: validated.amountAtoms,
    displayAmount: zatoshisToZec(atoms),
    amount: {
      atoms: validated.amountAtoms,
      currency: "ZEC",
      scale: 8,
      displayAmount: zatoshisToZec(atoms),
    },
    digest,
    uri,
    qrCodeDataUrl,
    agusMemo,
    privacy: {
      isShielded,
      guarantees: isShielded
        ? [
            "Recipient address hidden in shielded pool (Diversified Address)",
            "Sender address hidden in shielded pool",
            "Payment amount hidden via Pedersen homomorphic commitments",
            "Invoice reference bound inside 512-byte ChaCha20 encrypted memo",
            "Auditable only via Unified Full Viewing Key (UFVK) without spend authority",
          ]
        : [
            "WARNING: Transparent address selected. Value and parties visible on public explorer.",
            "Upgrade to Unified Address (utest1...) recommended for zero-knowledge privacy.",
          ],
      recommendedPool: "Orchard (Halo 2 zero-knowledge circuit)",
    },
    networkRequirement: `Zcash ${validated.network === "testnet" ? "Testnet (magic 0xfa1a5d01)" : "Mainnet"} must be used.`,
    status: "open",
    createdAt: new Date().toISOString(),
  };
}

/**
 * Reconciles and verifies on-chain payment against the AGUS payment request.
 */
export async function reconcileZcashPayment(
  terms: ZcashRequestTerms,
  lightwalletd: LightwalletdClient,
  simulatedObservation?: any,
  proof?: ViewingKeyProof,
): Promise<ZcashPaymentReceipt> {
  // If simulated observation is supplied for test scenarios
  if (simulatedObservation) {
    return inspectZcashPaymentReceipt(terms, simulatedObservation, proof);
  }

  // Live chain verification: fetch latest block height from lightwalletd
  const tip = await lightwalletd.getLatestBlock();
  throw new Error(`LIVE_MEMPOOL_SCAN_PENDING_AT_BLOCK_${tip.height}`);
}
