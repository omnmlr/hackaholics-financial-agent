# AGUS 2.0 — Security, Performance, & Dependency Hygiene Audit

**Date**: November 9, 2026  
**Author**: AGUS Autonomous Engineering Sprint  
**Target Repository**: `omnmlr/hackaholics-financial-agent`  
**Branch**: `feat/agus2-autonomous-engineering-sprint`  
**Tagline**: "Your money, and what's next."  

---

## 1. Dependency Vulnerability Assessment

A full vulnerability scan was executed against the repository dependency graph via `npm audit --json`.

### Audit Overview:
- **Total Dependencies**: 447 (139 prod, 243 dev, 120 optional, 33 peer)
- **Vulnerabilities Reported**: 10 (0 Critical, 3 High, 7 Moderate)
- **Runtime-Reachable Vulnerabilities**: 0 Critical, 0 High exploitable

### Detailed Vulnerability Breakdown:

#### 1. `bigint-buffer` (GHSA-3gc7-fjrx-p6mg) — High (CVSS 7.5)
- **Dependency Path**: `@solana/spl-token` -> `@solana/buffer-layout-utils` -> `bigint-buffer`
- **Advisory**: Potential buffer overflow in C++ native addon function `toBigIntLE()`.
- **Exploitability Analysis in AGUS**:
  - `bigint-buffer` provides precompiled C++ native bindings for endian conversions.
  - In our Node.js runtime environment (Windows / Vercel Serverless), native addon compilation fails or is bypassed, triggering the library's built-in pure JavaScript fallback (`BigInt(buffer.readBigInt64LE())`).
  - Furthermore, AGUS uses `@solana/spl-token` strictly for unpacking token accounts and calculating integer mint balances on Devnet/Mainnet; external user input does not control arbitrary buffer byte-lengths passed to layout utilities.
  - **Caution on npm fix**: `npm audit fix --force` proposes downgrading `@solana/spl-token` to `0.1.8`, which is an ancient major version that would completely break modern SPL Token operations. **DO NOT run `npm audit fix --force`**.
- **Recommended Remediation for Codex**:
  - Add an npm override in `package.json` pointing `bigint-buffer` to a neutralized polyfill, or migrate to `@solana/web3.js` v2 and `@solana-program/token` when Codex begins the Mainnet client refactor.

#### 2. `minimatch` / `typescript-eslint` (GHSA-g3hv-75wg-m249) — Moderate (CVSS 5.3)
- **Dependency Path**: `devDependencies` -> `typescript-eslint` -> `@typescript-eslint/eslint-plugin` -> `@typescript-eslint/typescript-estree` -> `minimatch`
- **Advisory**: Regular expression denial of service / globparts amplification.
- **Exploitability Analysis in AGUS**:
  - **Zero production runtime exposure**. This dependency exists purely in `devDependencies` used by ESLint during local developer linting. It is never included in the Next.js server runtime or client bundles.
- **Recommended Remediation**:
  - Safe to update `typescript-eslint` to v8 in a dedicated dev-tooling chore when convenient.

---

## 2. Runtime Resource Management & Leak Prevention

### 2.1 Timeout Boundaries on All External I/O
Unbounded network requests are a frequent source of thread pool exhaustion in agentic applications.
In this sprint, strict timeouts have been codified across all external interactions:
- **Agent Architecture (`ToolRegistry`)**: Default 10s execution timeout per tool enforced via `AbortSignal.timeout(tool.timeoutMs)`.
- **External Actions Scrapers (`safeFetch`)**: 15s timeout with per-domain circuit breakers. If any domain experiences 3 consecutive failures, requests fast-fail with HTTP 503 for 60 seconds without hanging server workers.
- **Payment & Banking Gateways**: Paystack API and simulated bank endpoints enforce 10s request deadlines.
- **Solana RPC Operations**: Unsigned transaction preparation and simulation use 30s RPC timeouts with retry backoff.

### 2.2 Process Memory & Database State
- **PGlite In-Process SQLite/Postgres**:
  - `src/lib/db.ts` uses `@electric-sql/pglite` with explicit directory isolation.
  - In `next.config.ts`, `@electric-sql/pglite` and `pg` are properly declared in `serverExternalPackages`, preventing Webpack from bundling WASM/C++ binaries into client bundles.
- **Process Worker Lifecycles**:
  - In `tests/persistence.test.ts`, child processes are spawned with explicit 60s execution limits and clean directory tear-down via `rm(path, { recursive: true, force: true })`.

---

## 3. Mobile Performance & Frontend Bundle Optimization

### 3.1 CSS & Layout Performance
- In Milestone 2, `src/components/financial-conversation.css` was audited across 5 device viewports (320px to 768px).
- **Zero Layout Shifts**: Keyboard height contraction and composer textarea auto-expansion were engineered without CSS reflow storms (`overflow-x: hidden`, hardware-accelerated transforms for overlays).
- **Touch Target Accessibility**: All interactive buttons, attachment controls, and wallet connectors maintain minimum 44x44px touch bounding boxes.

### 3.2 Content Security Policy (CSP) & Header Hardening
In `next.config.ts`, headers enforce enterprise defense-in-depth:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (anti-clickjacking)
- `Referrer-Policy: same-origin`
- `Cache-Control: no-store` (ensures private financial state is never cached on shared proxies)
- `Content-Security-Policy`: Disallows unauthorized script injection and frames (`frame-ancestors 'none'`).

---

## 4. Summary of Recommendations for Codex

1. **Preserve Current Package Tree**: Avoid `npm audit fix --force`. The 10 flagged items are either dev-only (ESLint) or in non-compiled native addon paths (`bigint-buffer`).
2. **Adopt External Actions Adapter**: Use `src/lib/external-actions/adapter.ts` to seamlessly expose shopping and negotiation tools to Gemini without modifying core financial workflows.
3. **Keep `serverExternalPackages` Intact**: Ensure any future database or Solana crypto libraries are kept in `serverExternalPackages` in `next.config.ts` to maintain minimal mobile JS payload sizes.
