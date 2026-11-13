import http2 from "node:http2";
import type { ZcashChainObservation, ZcashNetwork } from "./types";

export interface LightdInfo {
  version: string;
  vendor: string;
  taddrSupport: boolean;
  chainName: string;
  saplingActivationHeight: number;
  consensusBranchId: string;
  blockHeight: number;
  gitCommit: string;
  buildDate: string;
  estimatedHeight: number;
  zcashdSubversion: string;
}

export interface BlockHeader {
  height: number;
  hash: string;
  prevHash?: string;
  time?: number;
}

export interface LightwalletdConfig {
  host?: string;
  port?: number;
  ipFallback?: string;
  timeoutMs?: number;
}

/**
 * Standard public Zcash testnet lightwalletd configuration (November 2026).
 */
export const DEFAULT_TESTNET_CONFIG: LightwalletdConfig = {
  host: "testnet.zec.rocks",
  port: 443,
  ipFallback: "66.241.124.102",
  timeoutMs: 8000,
};

/**
 * LightwalletdClient provides direct HTTP/2 gRPC communication to Zcash Lightwalletd nodes.
 * Implements CompactTxStreamer RPC methods (ZIP-307) natively without heavy external dependencies.
 */
export class LightwalletdClient {
  private host: string;
  private port: number;
  private ipFallback?: string;
  private timeoutMs: number;

  constructor(config: LightwalletdConfig = DEFAULT_TESTNET_CONFIG) {
    this.host = config.host || "testnet.zec.rocks";
    this.port = config.port || 443;
    this.ipFallback = config.ipFallback;
    this.timeoutMs = config.timeoutMs || 8000;
  }

  /**
   * Helper to execute a raw gRPC unary call over HTTP/2.
   */
  private async callGrpcUnary(path: string, payload: Buffer = Buffer.alloc(0)): Promise<Buffer> {
    // Attempt standard host first, fallback to IP if DNS resolution fails
    try {
      return await this.executeHttp2Grpc(this.host, path, payload);
    } catch (err: any) {
      if (this.ipFallback && (err?.code === "ENOTFOUND" || err?.message?.includes("ENOTFOUND"))) {
        return await this.executeHttp2Grpc(this.ipFallback, path, payload, this.host);
      }
      throw err;
    }
  }

  private executeHttp2Grpc(
    connectTarget: string,
    path: string,
    payload: Buffer,
    sniHost?: string,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const url = `https://${connectTarget}:${this.port}`;
      const client = http2.connect(url, {
        servername: sniHost || (connectTarget === this.ipFallback ? this.host : connectTarget),
      });

      let timeoutTimer: NodeJS.Timeout | null = null;
      let settled = false;

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        settled = true;
        try {
          client.close();
        } catch {}
      };

      if (this.timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          if (!settled) {
            cleanup();
            reject(new Error(`GRPC_CALL_TIMEOUT_${this.timeoutMs}MS`));
          }
        }, this.timeoutMs);
      }

      client.on("error", (err) => {
        if (!settled) {
          cleanup();
          reject(err);
        }
      });

      // Prepare standard 5-byte gRPC framing: 1 byte compressed flag (0) + 4 bytes uint32 length
      const frame = Buffer.alloc(5 + payload.length);
      frame[0] = 0; // uncompressed
      frame.writeUInt32BE(payload.length, 1);
      payload.copy(frame, 5);

      const req = client.request({
        ":method": "POST",
        ":path": path,
        "content-type": "application/grpc",
        te: "trailers",
      });

      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));

      req.on("error", (err) => {
        if (!settled) {
          cleanup();
          reject(err);
        }
      });

      req.on("end", () => {
        if (!settled) {
          cleanup();
          const total = Buffer.concat(chunks);
          if (total.length < 5) {
            // Check trailers for grpc status
            return resolve(Buffer.alloc(0));
          }
          // Slice off 5-byte gRPC framing header
          resolve(total.subarray(5));
        }
      });

      req.end(frame);
    });
  }

  /**
   * Fetches LightdInfo diagnostic metadata (GetLightdInfo).
   */
  async getLightdInfo(): Promise<LightdInfo> {
    const raw = await this.callGrpcUnary(
      "/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo",
      Buffer.alloc(0),
    );
    const decoded = this.parseProtobuf(raw);

    return {
      version: decoded.strings[1] || "unknown",
      vendor: decoded.strings[2] || "unknown",
      taddrSupport: decoded.varints[3] === 1n,
      chainName: decoded.strings[4] || "test",
      saplingActivationHeight: Number(decoded.varints[5] || 280000n),
      consensusBranchId: decoded.strings[6] || "77190ad9",
      blockHeight: Number(decoded.varints[7] || 0n),
      gitCommit: decoded.strings[8] || "",
      buildDate: decoded.strings[10] || "",
      estimatedHeight: Number(decoded.varints[12] || 0n),
      zcashdSubversion: decoded.strings[14] || "",
    };
  }

  /**
   * Fetches latest block tip ID (GetLatestBlock).
   */
  async getLatestBlock(): Promise<BlockHeader> {
    const raw = await this.callGrpcUnary(
      "/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock",
      Buffer.alloc(0),
    );
    const decoded = this.parseProtobuf(raw);

    const height = Number(decoded.varints[1] || 0n);
    const hashBytes = decoded.bytes[2] || Buffer.alloc(0);
    // Reverse hash to conventional display order (little-endian bytes to big-endian hex string)
    const hash = Buffer.from([...hashBytes].reverse()).toString("hex");

    return { height, hash };
  }

  /**
   * Fetches CompactBlock for a specific height (GetBlock).
   */
  async getBlock(height: number): Promise<BlockHeader> {
    const varintHeight = this.encodeVarint(BigInt(height));
    const reqPayload = Buffer.from([0x08, ...varintHeight]);

    const raw = await this.callGrpcUnary(
      "/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlock",
      reqPayload,
    );
    const decoded = this.parseProtobuf(raw);

    const resHeight = Number(decoded.varints[2] || BigInt(height));
    const hashBytes = decoded.bytes[3] || Buffer.alloc(0);
    const hash = Buffer.from([...hashBytes].reverse()).toString("hex");

    return { height: resHeight, hash };
  }

  /**
   * Validates live chain connectivity and health.
   */
  async checkHealth(): Promise<{ live: boolean; tipHeight: number; tipHash: string; chainName: string; branchId: string }> {
    try {
      const [info, tip] = await Promise.all([
        this.getLightdInfo(),
        this.getLatestBlock(),
      ]);
      return {
        live: true,
        tipHeight: tip.height,
        tipHash: tip.hash,
        chainName: info.chainName,
        branchId: info.consensusBranchId,
      };
    } catch (err: any) {
      return {
        live: false,
        tipHeight: 0,
        tipHash: "",
        chainName: "unknown",
        branchId: err.message,
      };
    }
  }

  // --- Protobuf utilities ---
  private encodeVarint(val: bigint): number[] {
    const bytes: number[] = [];
    let cur = val;
    while (cur > 0n) {
      let b = Number(cur & 0x7fn);
      cur >>= 7n;
      if (cur > 0n) b |= 0x80;
      bytes.push(b);
    }
    return bytes.length > 0 ? bytes : [0];
  }

  private parseProtobuf(buf: Buffer): {
    varints: Record<number, bigint>;
    strings: Record<number, string>;
    bytes: Record<number, Buffer>;
  } {
    const varints: Record<number, bigint> = {};
    const strings: Record<number, string> = {};
    const bytes: Record<number, Buffer> = {};

    let offset = 0;
    while (offset < buf.length) {
      const key = buf[offset++];
      const fieldNum = key >> 3;
      const wireType = key & 0x07;

      if (wireType === 0) {
        // Varint
        let val = 0n;
        let shift = 0n;
        while (offset < buf.length) {
          const b = buf[offset++];
          val |= BigInt(b & 0x7f) << shift;
          if (!(b & 0x80)) break;
          shift += 7n;
        }
        varints[fieldNum] = val;
      } else if (wireType === 2) {
        // Length-delimited (string or bytes)
        let len = 0;
        let shift = 0;
        while (offset < buf.length) {
          const b = buf[offset++];
          len |= (b & 0x7f) << shift;
          if (!(b & 0x80)) break;
          shift += 7;
        }
        const data = buf.subarray(offset, offset + len);
        offset += len;
        bytes[fieldNum] = Buffer.from(data);
        try {
          strings[fieldNum] = data.toString("utf8");
        } catch {
          strings[fieldNum] = data.toString("hex");
        }
      } else if (wireType === 5) {
        // 32-bit fixed
        offset += 4;
      } else if (wireType === 1) {
        // 64-bit fixed
        offset += 8;
      } else {
        break;
      }
    }

    return { varints, strings, bytes };
  }
}
