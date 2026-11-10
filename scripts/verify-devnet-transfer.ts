/** No signing or submission. Bounded independent reads against pinned Devnet. */
import { readFile, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  DEVNET_RPC,
  DEVNET_GENESIS,
  type SolanaDraft,
} from "../src/lib/solana/contracts";
import { CIRCLE_DEVNET_USDC_MINT } from "../src/lib/solana/assets";
import {
  verifyDevnetTransfer,
  validateCircleDevnetMint,
} from "../src/lib/solana/acceptance";
import { validateEnvironment } from "../src/lib/environment";

const { values } = parseArgs({
  options: {
    probe: { type: "boolean", default: false },
    "draft-file": { type: "string" },
    output: { type: "string" },
  },
});
async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(DEVNET_RPC, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok || !response.body) throw new Error("DEVNET_RPC_READ_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 512_000) {
      await reader.cancel();
      throw new Error("DEVNET_RPC_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    body.jsonrpc !== "2.0" ||
    body.id !== 1 ||
    body.error ||
    !("result" in body)
  )
    throw new Error("DEVNET_RPC_INVALID_RESPONSE");
  return body.result;
}
async function mintInfo(): Promise<AccountInfo<Buffer>> {
  const result = (await rpc("getAccountInfo", [
    CIRCLE_DEVNET_USDC_MINT,
    { encoding: "base64", commitment: "finalized" },
  ])) as {
    value?: { owner: string; executable: boolean; data: [string, string] };
  };
  const value = result?.value;
  if (!value || value.data?.[1] !== "base64")
    throw new Error("DEVNET_MINT_UNAVAILABLE");
  // Lamports and rentEpoch are irrelevant to mint identity; do not convert RPC
  // values which may exceed JS safe-integer precision.
  return {
    data: Buffer.from(value.data[0], "base64"),
    owner: new PublicKey(value.owner),
    executable: value.executable,
    lamports: 0,
    rentEpoch: 0,
  };
}
try {
  if (validateEnvironment().profile !== "devnet")
    throw new Error("DEVNET_PROFILE_REQUIRED");
  if (values.probe === Boolean(values["draft-file"]))
    throw new Error("SELECT_PROBE_OR_DRAFT_FILE");
  const genesisHash = await rpc("getGenesisHash");
  if (genesisHash !== DEVNET_GENESIS)
    throw new Error("DEVNET_GENESIS_MISMATCH");
  let evidence;
  if (values.probe) {
    evidence = {
      classification: "genuine-public-read-only-observation",
      transferProven: false,
      network: "devnet",
      genesisHash,
      rpcEndpoint: DEVNET_RPC,
      mint: validateCircleDevnetMint(await mintInfo()),
    };
  } else {
    if ((await stat(values["draft-file"]!)).size > 32_768)
      throw new Error("DRAFT_FILE_TOO_LARGE");
    const draft = JSON.parse(
      await readFile(values["draft-file"]!, "utf8"),
    ) as SolanaDraft;
    const signature = draft.submission?.signature;
    if (
      typeof signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)
    )
      throw new Error("SAVED_SUBMISSION_REQUIRED");
    const statuses = (await rpc("getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: true },
    ])) as { value?: unknown[] };
    const transaction = await rpc("getTransaction", [
      signature,
      {
        commitment: "finalized",
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    const verified = verifyDevnetTransfer(
      draft,
      { genesisHash, status: statuses?.value?.[0], transaction },
      draft.asset === "SPL" ? await mintInfo() : undefined,
    );
    evidence = {
      classification: "genuine-devnet-finalized-transfer",
      transferProven: true,
      ...verified,
      retrieval:
        "independent read through pinned public RPC; not a second RPC provider",
      serverRestartVerified: false,
      walletInteractionVerified: false,
    };
  }
  const output =
    JSON.stringify(
      { ...evidence, observedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n";
  // Refuse overwrites. Neither input drafts, operator IDs nor sessions are logged.
  if (values.output)
    await writeFile(values.output, output, { flag: "wx", mode: 0o600 });
  console.log(output);
} catch (error) {
  console.error(
    error instanceof Error &&
      (error.message.startsWith("DEVNET_") || /^[A-Z_]+$/.test(error.message))
      ? error.message
      : "DEVNET_ACCEPTANCE_FAILED",
  );
  process.exitCode = 1;
}
