import type {
  SignatureStatus,
  VersionedTransactionResponse,
} from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { pinnedDevnetConnection } from "../lib/solana/rpc";
import { DEVNET_GENESIS, requireDevnet } from "../lib/solana/contracts";
import { database } from "./sql";
import { invariant, DomainError } from "./errors";
import { inspectRequestPayment, type RequestTerms } from "./request-chain";
import { getRequest, recordRequestReceipt } from "./requests";
export interface RequestChainReader {
  genesis(): Promise<string>;
  signatures(
    reference: string,
    before?: string,
  ): Promise<Array<{ signature: string; err: unknown }>>;
  read(signature: string): Promise<{
    status: SignatureStatus | null;
    transaction: VersionedTransactionResponse | null;
  }>;
}
function reader(): RequestChainReader {
  const c = pinnedDevnetConnection();
  return {
    genesis: () => c.getGenesisHash(),
    signatures: (reference, before) =>
      c.getSignaturesForAddress(
        new PublicKey(reference),
        { limit: 6, ...(before ? { before } : {}) },
        "finalized",
      ),
    async read(signature) {
      const [statuses, transaction] = await Promise.all([
        c.getSignatureStatuses([signature], { searchTransactionHistory: true }),
        c.getTransaction(signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        }),
      ]);
      return { status: statuses.value[0], transaction };
    },
  };
}
async function terms(owner: string, id: string) {
  await getRequest(owner, id);
  requireDevnet();
  const sql = await database();
  const count = (
    await sql.query(
      "INSERT INTO auth_attempts(key,attempts,reset_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.reset_at<=now() THEN 1 ELSE auth_attempts.attempts+1 END,reset_at=CASE WHEN auth_attempts.reset_at<=now() THEN now()+interval '1 minute' ELSE auth_attempts.reset_at END RETURNING attempts",
      [`request-chain:${owner}`],
    )
  ).rows[0].attempts;
  invariant(count <= 12, "REQUEST_DISCOVERY_THROTTLED", 429);
  const r = (
    await sql.query(
      "SELECT reference,recipient,asset,amount_atoms,mint,scale FROM agus_payment_requests WHERE owner=$1 AND id=$2",
      [owner, id],
    )
  ).rows[0];
  return {
    reference: r.reference,
    recipient: r.recipient,
    asset: r.asset,
    amountAtoms: r.amount_atoms,
    mint: r.mint,
    scale: r.scale,
  } as RequestTerms;
}
export async function matchExternalRequest(
  owner: string,
  id: string,
  signature: string,
  rpc: RequestChainReader = reader(),
) {
  const request = await terms(owner, id);
  invariant(
    /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature),
    "INVALID_SIGNATURE",
    400,
  );
  const genesisHash = await rpc.genesis();
  invariant(genesisHash === DEVNET_GENESIS, "WRONG_DEVNET_GENESIS", 502);
  const observation = await rpc.read(signature);
  return recordRequestReceipt(
    id,
    inspectRequestPayment(request, signature, { genesisHash, ...observation }),
  );
}
export async function discoverRequest(
  owner: string,
  id: string,
  cursor?: string,
  rpc: RequestChainReader = reader(),
) {
  const request = await terms(owner, id);
  let before: string | undefined;
  if (cursor) {
    invariant(cursor.length <= 512, "INVALID_CURSOR", 400);
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, "base64url").toString("utf8"),
      );
      invariant(
        parsed.reference === request.reference &&
          /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(parsed.before),
        "INVALID_CURSOR",
        400,
      );
      before = parsed.before;
    } catch {
      throw new DomainError("INVALID_CURSOR", 400);
    }
  }
  const genesisHash = await rpc.genesis();
  invariant(genesisHash === DEVNET_GENESIS, "WRONG_DEVNET_GENESIS", 502);
  const entries = (await rpc.signatures(request.reference, before)).slice(0, 6),
    visible = entries.slice(0, 5);
  const matches: Array<{ signature: string; additionalPayment: boolean }> = [],
    unresolved: Array<{ signature: string; code: string }> = [];
  for (const e of visible) {
    if (e.err !== null) {
      unresolved.push({
        signature: e.signature,
        code: "TRANSACTION_FAILED_OR_STATUS_UNKNOWN",
      });
      continue;
    }
    try {
      const observation = await rpc.read(e.signature);
      const receipt = inspectRequestPayment(request, e.signature, {
        genesisHash,
        ...observation,
      });
      const saved = await recordRequestReceipt(id, receipt);
      matches.push({
        signature: e.signature,
        additionalPayment: saved.additionalPayment,
      });
    } catch (error) {
      unresolved.push({
        signature: e.signature,
        code:
          error instanceof DomainError ? error.code : "CHAIN_READ_UNAVAILABLE",
      });
    }
  }
  return {
    request: await getRequest(owner, id),
    matches,
    unresolved,
    nextCursor:
      entries.length > 5
        ? Buffer.from(
            JSON.stringify({
              reference: request.reference,
              before: visible.at(-1)!.signature,
            }),
          ).toString("base64url")
        : null,
    historyComplete: false,
    coverage:
      "Bounded legacy SOL/classic TransferChecked reference discovery only. Unsupported, pending or pruned observations remain unresolved; no absence proves nonpayment.",
    automaticRefundAuthorized: false,
  };
}
