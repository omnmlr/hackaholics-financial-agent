# RC-01 Evidence Ledger — Repository Consolidation & Release Integration Audit

**Task / Lane:** Release Consolidation Audit (`agus_release_consolidation_audit`)  
**Date:** November 25, 2026  
**Workspace:** `C:\Users\USER\.gemini\antigravity\worktrees\hackaholics\agus_release_consolidation_audit`  
**Base Commit (`origin/feat/agus-crypto-backend` / PR #52):** `63abaebee506efc45308039167a7ffddef29257a`  
**Integration Target (`origin/integration/agus-crypto-hackathon-20261129`):** `a26880a97faac0cde495e0f7f667ce86f3f8978a`  
**Audit Report:** [CONSOLIDATION_AUDIT_20261125.md](../CONSOLIDATION_AUDIT_20261125.md)  
**Frontend Handoff Guide:** [CHISOM_ANDROID_INTEGRATION.md](../../CHISOM_ANDROID_INTEGRATION.md)

---

## 1. Ownership, Isolation, and Guardrail Compliance

- **Isolated worktree & branch**: `agus_release_consolidation_audit` branched from published `origin/feat/agus-crypto-backend` (`63abaebee506efc45308039167a7ffddef29257a`). No force pushes, resets, merges, branch deletions, PR closures, or edits to `feat/agus-crypto-backend` or Chisom's frontend UI code were performed.
- **No production / live infrastructure changes**: No changes were made to the live Stockholm EC2 host (`13.48.206.202` / `https://13-48-206-202.sslip.io`), Neon databases (`agus_crypto_devnet_20261124` / historical `agus_staging`), or Vercel DAL hosting.
- **Zero-overlap documentation consolidation**: Incorporated approved PR #51 (`b3d6228`) specs verbatim and added audit/integration documentation without modifying `CONTROL_PLANE.md`, `TASK_BOARD.md`, source routes, SQL, or generated contract files.

### Changed Paths Added on RC Branch (`63abaeb..HEAD`)

1. `docs/agus-crypto/PRD.md` — verbatim approved PRD from PR #51 (`b3d6228`, 179 lines).
2. `docs/agus-crypto/API_CONTRACT.md` — verbatim approved v1 API contract from PR #51 (`b3d6228`, 311 lines).
3. `docs/agus-crypto/CHISOM_ANDROID_INTEGRATION.md` — actionable Android API 1.1.0 integration guide for Chisom (`FE-01`).
4. `docs/agus-crypto/engineering/CONSOLIDATION_AUDIT_20261125.md` — complete 24-PR classification, PR #54/#55/#56 vs PR #52 verification, PR #53/#57 conflict root-cause analysis, branch strategy, merge order, and PR closure list.
5. `docs/agus-crypto/engineering/evidence/rc-consolidation-20261125.md` — this evidence ledger.

---

## 2. Git Forensics & Conflict Verification

| Check | Command | Result |
|---|---|---|
| Open PRs inventory (`github.com` REST API, `2026-11-25`) | `curl.exe -fsSL https://api.github.com/repos/omnmlr/hackaholics-financial-agent/pulls?state=open&per_page=100` | `exit 0`; **24 open PRs** (`#28, #29, #36..#57`). |
| Root epoch check | `git rev-list --max-parents=0 --all` | Two disjoint epochs: Epoch 1 (`1e11a57`, `4ee9649` for `main` + `#28..#44`) and Epoch 2 (`4e378f4` for `a26880a` + `#45..#57`). |
| PR #51 compatibility vs `#52` (`63abaeb`) | `git merge-tree --write-tree 63abaeb b3d6228` | `exit 0`, tree `467cf30485ea9e53f09cdb284f051f9cc60e5d44` (`+2` files, `+490` lines, zero conflicts). |
| PR #53 vs `#52` (`63abaeb`) | `git merge-tree --write-tree 63abaeb c66bf76` & `git cherry -v 63abaeb c66bf76` | `exit 0`, tree `4fcc93c0040bb004e3e6f8dedd1135651a3d79ba` (identical to `63abaeb^{tree}`); all 4 commits (`1190980..c66bf76` / `e00412c..4bed25e`) marked `-` (already applied). GitHub `mergeable: null` (`merge_commit_sha: 62e1a17` built at `81a274e`). |
| PR #57 vs `#52` (`63abaeb`) | `git merge-tree --write-tree 63abaeb b9c631b` | `exit 0`, tree `f48e88f15e2238a2e072963cb2168b234547806f` (`+4/-3` on `.github/workflows/agus-crypto-devnet-image.yml`, pinning obsolete `126a528`). GitHub `mergeable: null` (`merge_commit_sha: d69e098` built at `126a528`). |
| PR #29 & #39 vs `main` (`d66c460`) | `git merge-tree --write-tree d66c460 5fc0eac` & `d66c460 780c457` | `exit 1`: `CONFLICT (content): Merge conflict in README.md` (`base.sha: 292d0b1`). |
| PR #54, #55, #56 vs `#52` (`63abaeb`) | `git diff --stat <pr_head> 63abaeb -- <files>` | Confirmed `ag-01/02/03` docs identical; `22fd254` fixed pre-submission handoff marker & concurrency + `crypto-mobile-standalone.test.ts` (`+9/-7`); `8e97ddd` moved SQL proposal to `ag-03-proposed.sql.txt`, locked `agus_users` in `execution.ts:289-295`, and revoked mutating grants in `crypto-devnet-runtime-login.sql:18-21`; `d9bd46b` hardened `Caddyfile`, pinned Caddy digest, and isolated `crypto-api.env`. |

---

## 3. Verification Commands & Outcomes (Scope Distinguished)

### A. Static, Contract, Lint, and Bundle Checks (Local Implementation)

*(All checks executed on workspace `agus_release_consolidation_audit`; re-verified after final documentation edits prior to commit.)*

| Check | Command | Exit | Observed Result |
|---|---|---|---|
| Dependency install | `npm.cmd ci --ignore-scripts` | `0` | `added 1069 packages, and audited 1073 packages` |
| Web/server typecheck | `npm.cmd run typecheck` | `0` | Zero TypeScript errors |
| Mobile typecheck | `npm.cmd run mobile:typecheck` | `0` | Zero TypeScript errors |
| ESLint | `npm.cmd run lint` | `0` | Zero lint errors |
| Fixture config guard | `$env:AGUS_ENVIRONMENT='fixture'; npm.cmd run config:validate` | `0` | `{"profile":"fixture","banking":"simulated","solana":"disabled","acceptedSourceInstitutions":0}` |
| OpenAPI + Client codegen parity | `npm.cmd run contracts:generate; git diff --exit-code -- packages/contracts/openapi.json packages/api-client/src/generated.ts` | `0` | Zero contract/client drift |
| Expo Android release JS/HBC bundle | `$env:EXPO_PUBLIC_API_URL='https://prototype.fixture.invalid'; npm.cmd run mobile:export:android` | `0` | Bundled `apps\mobile\index.ts` (`1096 modules`, `5.6MB` `.hbc`) |

### B. Automated Test Suites (Local Mocked / Fixture / PGlite)

| Suite / Command | Exit | Counts & Exact Details |
|---|---|---|
| Focused Crypto + Mobile + Platform (12 files, pre-doc-add) | `0` | **11 passed \| 1 skipped (12) files; 109 passed \| 21 skipped (130) tests.** Passed: `crypto-contract` (`9`), `crypto-research` (`20`), `crypto-adversarial` (`24`, incl. `NEG-11`), `crypto-mobile` (`8`), `crypto-mobile-standalone` (`11`), `crypto-voice` (`9 pass \| 1 live skipped`), `crypto-multimodal` (`1 pass \| 5 skipped`), `crypto-wallet-reliability` (`1 pass \| 4 skipped`), `crypto-swap-quote` (`1 pass \| 1 skipped`), `environment` (`14`), `provider-diagnostics` (`11`). Skipped without DB URL: `crypto-backend` (`10/10`). |
| Full Vitest suite (`npm.cmd test`) | `1` | **92 passed \| 15 failed \| 5 skipped (112) files; 1673 passed \| 14 failed \| 104 skipped (1791) tests** (`2398.03s`). Every Solana/Crypto logic & security file passed (`crypto-adversarial`, `crypto-contract`, `crypto-research`, `crypto-multimodal`, `crypto-wallet-reliability`, `crypto-swap-quote`, `crypto-mobile`, `crypto-mobile-standalone`, `solana-core`, `solana-acceptance`, `solana-classic-spl`, `solana-rpc`, `solana-approval-route`, `solana-followups`). All 15 file failures were environment/timing limits: (a) 5 `beforeAll` hook timeouts (`15s`/`30s`, incl. `crypto-voice` PGlite init); (b) 9 `node --import tsx` child-process restart/persistence files (`12` test cases timing out at `20s`–`31s`, `ETIMEDOUT`/`status null`); (c) 2 `<500ms` latency thresholds in `financial-intelligence/performance-benchmark.test.ts` (`616.7ms`, `574.9ms`). Skipped (`5` files): `crypto-backend`, `platform`, `marketplace-usd`, `request-discovery`, `payment-requests-platform`. |
| Isolated re-run (`crypto-voice.test.ts` + `performance-benchmark.test.ts`) | `1` | `tests/crypto-voice.test.ts`: cold Windows `PGlite` `beforeAll` exceeded default `15000ms` hook timeout (`30966ms` total, `10 skipped`); `performance-benchmark.test.ts`: search passed (`495ms`), 5,000-tx analytics (`810.8ms` vs `<500ms`) and CSV export (`639.9ms` vs `<500ms`) failed host timing budget. |
| AWS preflight tests (`vitest run --config deploy/crypto/aws/vitest.config.ts`) | `1` | **36 passed \| 5 failed (41)** (`338.37s`). All 5 failures hit `preflight.test.ts:135` `timeout: 50000` on Windows `node --import tsx` spawn (`stderr=""`). Direct execution of `node --import tsx --import ./deploy/crypto/aws/tests/helpers/devnet-harness.mjs scripts/crypto-devnet.ts api` (`TEST_HARNESS_DB_MODE=uninitialized`) exited fail-closed (`exit 1`) in `42.16s` printing `Crypto Devnet startup failed (SCHEMA_MIGRATION_REQUIRED)`. |
| EC2 deploy unit tests (Windows host Python) | `1` | `python -B -m unittest discover -s deploy/crypto/ec2 -p "test_*.py"` failed: `ModuleNotFoundError: No module named 'fcntl'` (POSIX-only import in `deploy-stockholm.py`). |
| EC2 deploy unit tests (WSL Linux Python) | `0` | `wsl.exe python3 -B -m unittest discover -s deploy/crypto/ec2 -p "test_*.py"`: `Ran 1 test in 0.008s` (`OK`). |

### C. Explicit Boundaries Not Re-Executed in This Audit

- **PostgreSQL `AGUS_TEST_DATABASE_URL` integration**: Not run locally (tests skipped `10/10` in `crypto-backend.test.ts` and `29/29` in `platform.test.ts`).
- **Live provider / hosted deployment / physical handset**: Not re-executed by this audit; relies on PR #52 recorded acceptance (`aa9e307`, `d9bd46b`) for Stockholm Devnet (`https://13-48-206-202.sslip.io` at `126a528`) while post-`126a528` deployment, live Google OAuth/Resend wiring, signed release APK, and `ANDROID_DEVICE_TEST.md` physical transfers remain founder `REL-01` / `OP-01` gates after `FE-01`.
- **REA MCP**: Unused/not applicable because no native compiled/packaged binary reverse-engineering was needed for git/source audit; all findings come from inspected source, git commits, GitHub PR metadata, and real local execution.
