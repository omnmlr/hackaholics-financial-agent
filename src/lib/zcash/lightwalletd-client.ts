/** Read-only AG-ZCASH integration (b9efe96), hardened for HTTP/gRPC errors and malformed replies. Public metadata cannot verify a shielded payment. */
import http2 from "node:http2";

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
  private async callGrpcUnary(
    path: string,
    payload: Buffer = Buffer.alloc(0),
  ): Promise<Buffer> {
    // Attempt standard host first, fallback to IP if DNS resolution fails
    try {
      return await this.executeHttp2Grpc(this.host, path, payload);
    } catch (err: unknown) {
      if (
        this.ipFallback &&
        err instanceof Error &&
        (("code" in err && err.code === "ENOTFOUND") ||
          err.message.includes("ENOTFOUND"))
      ) {
        return await this.executeHttp2Grpc(
          this.ipFallback,
          path,
          payload,
          this.host,
        );
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
        servername:
          sniHost ||
          (connectTarget === this.ipFallback ? this.host : connectTarget),
      });

      let timeoutTimer: NodeJS.Timeout | null = null;
      let settled = false;

      const cleanup = () => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        settled = true;
        try {
          client.destroy();
        } catch { /* The peer may already have closed the session. */ }
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
      let received = 0,
        httpStatus = 0,
        grpcStatus: string | undefined;
      req.on("response", (headers) => {
        httpStatus = Number(headers[":status"]);
        if (headers["grpc-status"] !== undefined)
          grpcStatus = String(headers["grpc-status"]);
      });
      req.on("trailers", (headers) => {
        if (headers["grpc-status"] !== undefined)
          grpcStatus = String(headers["grpc-status"]);
      });
      req.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > 4_000_000 && !settled) {
          cleanup();
          reject(new Error("GRPC_RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });

      req.on("error", (err) => {
        if (!settled) {
          cleanup();
          reject(err);
        }
      });

      req.on("end", () => {
        if (!settled) {
          const total = Buffer.concat(chunks);
          cleanup();
          if (httpStatus !== 200 || grpcStatus !== "0")
            return reject(new Error("GRPC_UPSTREAM_ERROR"));
          if (
            total.length < 5 ||
            total[0] !== 0 ||
            total.readUInt32BE(1) !== total.length - 5
          )
            return reject(new Error("INVALID_GRPC_FRAME"));
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

    if (!decoded.strings[4] || !decoded.strings[6] || !decoded.varints[7])
      throw new Error("INVALID_LIGHTD_INFO");
    return {
      version: decoded.strings[1] || "unknown",
      vendor: decoded.strings[2] || "unknown",
      taddrSupport: decoded.varints[3] === 1n,
      chainName: decoded.strings[4],
      saplingActivationHeight: Number(decoded.varints[5] || 0n),
      consensusBranchId: decoded.strings[6],
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

    if (!Number.isSafeInteger(height) || height <= 0 || hash.length !== 64)
      throw new Error("INVALID_BLOCK_ID");
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

    const resHeight = Number(decoded.varints[2] || 0n);
    const hashBytes = decoded.bytes[3] || Buffer.alloc(0);
    const hash = Buffer.from([...hashBytes].reverse()).toString("hex");

    if (resHeight !== height || hash.length !== 64)
      throw new Error("INVALID_BLOCK_HEADER");
    return { height: resHeight, hash };
  }

  /**
   * Validates live chain connectivity and health.
   */
  async checkHealth(): Promise<{
    live: boolean;
    tipHeight: number;
    tipHash: string;
    chainName: string;
    branchId: string;
  }> {
    try {
      const [info, tip] = await Promise.all([
        this.getLightdInfo(),
        this.getLatestBlock(),
      ]);
      return {
        live: info.chainName === "test" && tip.height > 0,
        tipHeight: tip.height,
        tipHash: tip.hash,
        chainName: info.chainName,
        branchId: info.consensusBranchId,
      };
    } catch (err: unknown) {
      return {
        live: false,
        tipHeight: 0,
        tipHash: "",
        chainName: "unknown",
        branchId: err instanceof Error ? err.message : "NETWORK_UNAVAILABLE",
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
    const readVarint = () => {
      let val = 0n;
      for (let shift = 0n; shift < 70n; shift += 7n) {
        if (offset >= buf.length) throw new Error("TRUNCATED_PROTOBUF");
        const byte = buf[offset++];
        val |= BigInt(byte & 127) << shift;
        if (!(byte & 128)) return val;
      }
      throw new Error("INVALID_PROTOBUF_VARINT");
    };
    while (offset < buf.length) {
      const key = Number(readVarint()),
        fieldNum = key >>> 3,
        wireType = key & 7;
      if (!fieldNum) throw new Error("INVALID_PROTOBUF_FIELD");
      if (wireType === 0) varints[fieldNum] = readVarint();
      else if (wireType === 2) {
        const len = Number(readVarint());
        if (!Number.isSafeInteger(len) || len < 0 || offset + len > buf.length)
          throw new Error("TRUNCATED_PROTOBUF_BYTES");
        const data = buf.subarray(offset, offset + len);
        offset += len;
        bytes[fieldNum] = Buffer.from(data);
        strings[fieldNum] = data.toString("utf8");
      } else if (wireType === 5 || wireType === 1) {
        offset += wireType === 5 ? 4 : 8;
        if (offset > buf.length) throw new Error("TRUNCATED_PROTOBUF_FIXED");
      } else throw new Error("UNSUPPORTED_PROTOBUF_WIRE_TYPE");
    }

    return { varints, strings, bytes };
  }
}
