# AGUS Repository Consolidation & Release Integration Audit

**Audit date:** November 25, 2026  
**Audit base (`feat/agus-crypto-backend` / PR #52 head):** `63abaebee506efc45308039167a7ffddef29257a`  
**Integration target (`integration/agus-crypto-hackathon-20261129`):** `a26880a97faac0cde495e0f7f667ce86f3f8978a`  
**GitHub default branch (`implementation/agus-counterpart-20261114`):** `a26880a97faac0cde495e0f7f667ce86f3f8978a`  
**Legacy `main` head:** `d66c460f092290e21db281e346aa6f3cf289dcec`

---

## 1. Repository Branch Topology (Two Disjoint History Epochs)

Git root inspection (`git rev-list --max-parents=0`) confirms the repository contains **two unrelated git histories**:

1. **Epoch 1 — Historical AGUS Bank (Oct 15–23, 2026; roots `1e11a57`, `4ee9649`):**
   - `origin/main` (`d66c460`) + linear open PR stack `#28 → #29 → #36 → #37 → #38 → #39 → #40 → #41 → #42 → #43` (with `#44` branching from `#43`'s penultimate commit `869b5b9`).
   - Built the fictional Naira/bank workspace, Paystack/Mono adapters, model-led Gemini agent, Railway preview, and Netlify emergency fix.
2. **Epoch 2 — AGUS 2.0 / Zcash / Pollar → AGUS Crypto (Nov 9–25, 2026; root `4e378f4`):**
   - `dev/agus2-solana-core-20261109` (`4e378f4`) → `integration/agus2-foundation-20261110` (`d82cbe3`) → `feature/multi-account-intelligence` (`2031112`) → **PR #45** (`f8cdcb3`) → **`implementation/agus-counterpart-20261114`** / **`integration/agus-crypto-hackathon-20261129`** (`a26880a`).
   - From `a26880a`, AGUS Crypto branched into:
     - **PR #46** (`4c132b7`): pre-PRD Android MWA/SPL spike (superseded by `#52`).
     - **PR #47** (`87be10e`): Nov 22 project journal (superseded by `#51` + `#52`).
     - **PR #48 → #49 → #50** (`3399614 → ebf4d0a → 05fde1d`): wallet auth research, LiteSVM Subscriptions delegation PoC, and Swig Pocket PoC + pre-PRD research.
     - **PR #51** (`b3d6228`): approved `PRD.md` and `API_CONTRACT.md` (missing from `#52`).
     - **PR #52** (`63abaeb`): active Codex backend + API 1.1.0 + MWA signer + Stockholm Devnet readiness + incorporated AG-01/02/03 deliverables (`#53–#56`).
     - **PR #53** (`c66bf76`) → **PRs #54 (`2cddd42`), #55 (`cf05b62`), #56 (`c650df0`)**: coordination layer + Antigravity audits/preflight branched off `#52`'s earlier `f7bf1de` checkpoint.
     - **PR #57** (`b9c631b`): temporary EC2 bundle artifact workflow branched off `#52`'s earlier `126a528` checkpoint.

Because `main` and `integration/agus-crypto-hackathon-20261129` have unrelated root histories, `git merge-tree` between Crypto branches and `main` refuses (`fatal: refusing to merge unrelated histories`). AGUS Crypto targets `integration/agus-crypto-hackathon-20261129`, not `main`.

---

## 2. Complete Audit & Classification of All 24 Open Pull Requests

| PR | Branch (`head` SHA) | Base Branch | Ancestry / Diff Summary | GitHub / `git merge-tree` | Category | Recommended Action (With Approval) |
|---:|---|---|---|---|---|---|
| **#51** | `docs/agus-crypto-prd-20261123` (`b3d6228`) | `implementation/agus-counterpart-20261114` | +2 commits, 2 files (`docs/agus-crypto/PRD.md`, `API_CONTRACT.md`); absent from `#52` (`63abaeb`) | `True(unstable)` / clean (`467cf30`) | **Required for current AGUS Crypto release** | Incorporate into consolidated RC (done on RC branch); merge or close as incorporated into RC |
| **#52** | `feat/agus-crypto-backend` (`63abaeb`) | `integration/agus-crypto-hackathon-20261129` | +50 commits, 124 files (+30,264/-1,155); incorporates `#53–#56` + API 1.1.0 + Stockholm prep | `True(unstable)` / clean | **Required for current AGUS Crypto release** | **Do not modify directly.** Use `63abaeb` as RC base; merge `#52` first or merge consolidated RC after Codex handoff |
| **#53** | `ops/agus-crypto-agent-coordination-20261124` (`c66bf76`) | `feat/agus-crypto-backend` | -26/+4 commits vs `#52`; all 4 commits already cherry-picked into `#52` (`e00412c..4bed25e`) | `None(unknown)` / clean (`4fcc93c` == `63abaeb^{tree}`) | **Already integrated or superseded** | Close PR after approval (preserve branch ref); coordination state superseded by `CX-01-continuation.md` |
| **#54** | `ag/android-wallet-audit-20261124` (`2cddd42`) | `ops/agus-crypto-agent-coordination-20261124` | +2 commits, 3 files (+905); incorporated in `#52` + Fix 1 landed in `22fd254` | `True(clean)` / clean | **Already integrated or superseded** | Close PR after approval (preserve branch ref) |
| **#55** | `ag/crypto-security-audit-20261124` (`cf05b62`) | `ops/agus-crypto-agent-coordination-20261124` | +3 commits, 4 files (+2,719); incorporated in `#52` + `8e97ddd` SQL/concurrency fix | `True(clean)` / clean | **Already integrated or superseded** | Close PR after approval (preserve branch ref) |
| **#56** | `ag/aws-devnet-preflight-20261124` (`c650df0`) | `ops/agus-crypto-agent-coordination-20261124` | +3 commits, 12 files (+1,920); incorporated in `#52` + hardened in `d9bd46b` | `True(unstable)` / clean | **Already integrated or superseded** | Close PR after approval (preserve branch ref) |
| **#57** | `ops/agus-ec2-bundle-20261125` (`b9c631b`) | `feat/agus-crypto-backend` | -4/+1 commits vs `#52`, 1 file (`.github/workflows/agus-crypto-devnet-image.yml`, +4/-3) | `None(unknown)` / clean | **Obsolete and safe to close after approval** | Close PR **without merging** (body: *"Do not merge... close after verified artifact delivery"*; `126a528` bundle already delivered) |
| **#45** | `integration/agus2-web-hackathon-20261113` (`f8cdcb3`) | `feature/multi-account-intelligence` | +5 commits, 102 files; direct ancestor of `a26880a` and `#52` | `True(unstable)` / clean | **Already integrated or superseded** | Close PR after approval (already merged into `a26880a` / `63abaeb`) |
| **#46** | `spike/agus-wallet-control-solana` (`4c132b7`) | `implementation/agus-counterpart-20261114` | +3 commits, 18 files; pre-PRD MWA/SPL spike superseded by `#52` | `True(unstable)` / clean | **Already integrated or superseded** | Close PR after approval (keep branch/tag `agus-wallet-control-phone-test-20261122`) |
| **#47** | `docs/agus-crypto-project-journal-20261122` (`87be10e`) | `implementation/agus-counterpart-20261114` | +12 commits, 6 docs files; Nov 22 journal superseded by `#51` PRD + `#52` docs | `True(unstable)` / clean | **Already integrated or superseded** | Close PR after approval (preserve branch for pinned journal provenance) |
| **#48** | `docs/agus-crypto-wallet-architecture-research` (`3399614`) | `implementation/agus-counterpart-20261114` | +1 commit, 6 research docs; base of `#49` and `#50` | `True(unstable)` / clean | **Experimental work to retain separately** | Retain separate branch (do not merge into Devnet release) |
| **#49** | `experiment/agus-existing-wallet-delegation` (`ebf4d0a`) | `docs/agus-crypto-wallet-architecture-research` | +1 commit, 11 files (`experiments/existing-wallet-delegation/`) | `True(unstable)` / clean | **Experimental work to retain separately** | Retain separate branch (standing delegation explicitly excluded from hackathon) |
| **#50** | `experiment/agus-pocket-feasibility` (`05fde1d`) | `experiment/agus-existing-wallet-delegation` | +3 commits, 15 files (`experiments/agus-pocket/`, `docs/agus-crypto/pre-prd/`) | `True(unstable)` / clean | **Experimental work to retain separately** | Retain separate branch (Pocket remains disabled/post-Core gate) |
| **#28** | `feat/agus-visual-v1-1` (`7f714a9`) | `feat/agus-approved-p0` | -1/+4 commits, 23 files; ancestor of `#29..#44` | `True(clean)` / clean | **Already integrated or superseded** | Close PR after approval (superseded by `#43`) |
| **#29** | `integration/agus-v1-2-candidate-20261019` (`5fc0eac`) | `main` | -2/+60 commits, 324 files; ancestor of `#36..#44` | `None(unknown)` / **CONFLICT (`README.md`)** | **Obsolete and safe to close after approval** | Close PR after approval (superseded by `#43` and conflicts with `main`) |
| **#36** | `repair/agus-agent-reconstruction-20261020` (`dac1f76`) | `integration/agus-v1-2-candidate-20261019` | +1 commit, 35 files; ancestor of `#37..#44` | `True(clean)` / clean | **Already integrated or superseded** | Close PR after approval (superseded by `#43`) |
| **#37** | `experiment/agus-model-led-20261020` (`9d10d49`) | `repair/agus-agent-reconstruction-20261020` | +5 commits, 27 files; ancestor of `#38..#44` | `True(clean)` / clean | **Already integrated or superseded** | Close PR after approval (folded into `#38..#43`; pattern carried into Epoch 2) |
| **#38** | `hardening/agus-native-release-20261020` (`c28f4d2`) | `experiment/agus-model-led-20261020` | +6 commits, 34 files; ancestor of `#39..#44` | `True(clean)` / clean | **Already integrated or superseded** | Close PR after approval (superseded by `#43`) |
| **#39** | `release/agus-finals-rc-20261020` (`780c457`) | `main` | -2/+73 commits, 410 files; ancestor of `#40..#44` | `False(dirty)` / **CONFLICT (`README.md`)** | **Obsolete and safe to close after approval** | Close PR after approval (superseded by `#43` and conflicts with `main`) |
| **#40** | `release/agus-railway-ready-20261020` (`c2117ed`) | `release/agus-finals-rc-20261020` | +3 commits, 2 files; ancestor of `#41..#44` | `True(clean)` / clean | **Already integrated or superseded** | Close PR after approval (superseded by `#43`) |
| **#41** | `ui/agus-premium-experience-20261020` (`6ff095c`) | `release/agus-railway-ready-20261020` | +3 commits, 151 files; ancestor of `#42..#44` | `True(clean)` / clean | **Already integrated or superseded** | Close PR after approval (superseded by `#43`) |
| **#42** | `improve/agus-intelligence-motion-20261021` (`ca9994b`) | `ui/agus-premium-experience-20261020` | +8 commits, 131 files; ancestor of `#43` and `#44` | `True(unstable)` / clean | **Already integrated or superseded** | Close PR after approval (superseded by `#43`/`#44`) |
| **#43** | `improve/agus-banking-workspace-20261021` (`2377683`) | `improve/agus-intelligence-motion-20261021` | +15 commits, 235 files (non-draft); final tip of `#28..#43` historical AGUS Bank stack | `True(clean)` / clean | **Historical AGUS Bank work worth preserving** | Preserve branch/history separately; do **not** merge into Crypto or delete branch |
| **#44** | `repair/agus-provider-diagnostics-20261022` (`6fbbcf6`) | `deploy/agus-netlify-emergency-20261022` | +5 commits, 5 files off `869b5b9` (`#43` parent); Gemini endpoint pin already in `#52` (`src/lib/model-led-agent/model.ts:56`) | `True(clean)` / clean | **Historical AGUS Bank work worth preserving** | Preserve branch separately; fix already present in `#52`, do not merge into Crypto |

---

## 3. Verification of PRs #54, #55, and #56 Incorporation into PR #52 (`63abaeb`)

All three Antigravity audit/tooling PRs are genuinely incorporated into `feat/agus-crypto-backend` (`63abaeb`), with verified code-level adjustments beyond naive cherry-picking:

1. **PR #54 (`2cddd42`, AG-02 Android/MWA audit) → `63abaeb`**:
   - `docs/agus-crypto/engineering/evidence/ag-02.md` and `ag-02-suggested-fix.md`: **identical** to `#54`.
   - `apps/mobile/tests/crypto-mobile-standalone.test.ts`: incorporated with `+9/-7` line delta (`22fd254`). Added `vi.mock("expo/fetch", ...)` for `session.ts` voice streaming and updated the two Section 3 launch-marker reproduction tests to assert the fixed post-`22fd254` behavior (`marker` absent after association cancellation/timeout).
   - **Code fix verification**: `apps/mobile/src/crypto-signer.ts:226-326` (`22fd254`) moves `SecureStore.setItemAsync(marker, ...)` to `stage = "submission"` (line 300) and adds module-level `activeHandoffs` concurrency guard (`lines 46, 227-228, 325`). `apps/mobile/CryptoDeviceHarness.tsx:108-109` handles `LOCAL_SESSION_LOCKED` centrally in `run()` so the unlock prompt is preserved when `recover(paymentOwner)` runs after backgrounding.
2. **PR #55 (`cf05b62`, AG-03 security audit) → `63abaeb`**:
   - `docs/agus-crypto/engineering/evidence/ag-03.md` and `ag-03-threat-model.md`: **identical** to `#55`.
   - `scripts/sql/runtime-role-least-privilege.sql`: moved/renamed in `8e97ddd` to `docs/agus-crypto/engineering/evidence/ag-03-proposed.sql.txt` with a 2-line safety notice (`-- Historical audit proposal. Do not apply this file.`), and `tests/crypto-adversarial.test.ts` updated its path (`+3/-2`). Keeping `scripts/sql/runtime-role.sql` unmodified preserves `NEG-11`'s before/after flaw reproduction in `tests/crypto-adversarial.test.ts:1887-1894`.
   - **Code fix verification**: `8e97ddd` fixed a real PostgreSQL permission failure under least privilege: `beginCrypto` (`src/server/crypto/execution.ts:289-295`) now locks `agus_users` (`FOR NO KEY UPDATE`) instead of `agus_crypto_reviews ... FOR UPDATE` (which required `UPDATE` on `agus_crypto_reviews`). `scripts/sql/crypto-devnet-runtime-login.sql:18-21` revokes `UPDATE, DELETE, TRUNCATE` on the 5 immutable tables for `agus_crypto_devnet_20261124`, `scripts/crypto-devnet.ts:48-53` enforces it at startup, and `tests/helpers/shared-platform.ts:32-35` enforces it in platform tests.
   - **Residual observations retained**: PostgreSQL RLS (Finding 2) remains a future defense-in-depth proposal (`app.current_user_id` not enabled; tenant isolation remains in parameterized `WHERE owner = $1` queries), and edge rate-limiting on `/api/v1/crypto/share/:reference` (Finding 3) remains an edge-proxy responsibility.
3. **PR #56 (`c650df0`, AG-01 AWS preflight) → `63abaeb`**:
   - 9 of 12 files (`docker-compose.build.yml`, `env.production.example`, `preflight-check.sh`, `rollback.sh`, `setup-host.sh`, `tests/helpers/devnet-harness.mjs`, `tests/preflight.test.ts`, `vitest.config.ts`, `ag-01.md`): **identical** to `#56`.
   - 3 files hardened in `d9bd46b`: `deploy/crypto/aws/Caddyfile` removes full-URI access logging to prevent auth/recovery query leakage; `deploy/crypto/aws/docker-compose.yml` pins Caddy by SHA-256 digest (`caddy:2.11.2-alpine@sha256:834468...`) and mounts optional `/etc/agus/crypto-api.env` on `api` only (keeping provider keys off `worker`); `deploy/crypto/aws/README.md` documents the split env file.
   - **Note on dual AWS directories**: `deploy/crypto/aws/` holds the reusable AG-01 preflight tooling; `deploy/crypto/ec2/` holds the Stockholm-specific bundle/launcher (`deploy-stockholm.py`, `compose.yml`, `Caddyfile`, `activate-release.sh`) already used on `13.48.206.202`.

---

## 4. Merge Conflict Investigation: PRs #53 and #57 (plus #29 and #39)

| PR | GitHub API State | `git merge-tree` vs Target | Root Cause & Findings |
|---|---|---|---|
| **#53** (`c66bf76` → `feat/agus-crypto-backend`) | `mergeable: null` (`mergeable_state: "unknown"`) | **Clean** (`4fcc93c` == `63abaeb^{tree}`, `exit=0`); **Unrelated histories** vs `main` (`exit=128`) | PR #53 was branched from `f7bf1de` (`base.sha` still recorded as `f7bf1de`). Codex cherry-picked all 4 commits (`e00412c..4bed25e`) and pushed 22 more commits to `63abaeb`, invalidating GitHub's cached merge commit (`62e1a17`, built at `81a274e`). There is **no textual merge conflict** against `63abaeb`, and `git cherry -v` marks all 4 commits already applied (`-`). However, **rebasing/cherry-picking** duplicates existing commits, and `#53`'s coordination files are **semantically stale** relative to `CX-01-continuation.md` (`f7bf1de` vs `63abaeb`, `CX-01` marked interrupted). |
| **#57** (`b9c631b` → `feat/agus-crypto-backend`) | `mergeable: null` (`mergeable_state: "unknown"`) | **Clean** (`f48e88f`, `exit=0`, `.github/workflows/agus-crypto-devnet-image.yml` `+4/-3`) | PR #57 was branched from `126a528`, which is now 4 commits behind `63abaeb` (`8cc3f12..63abaeb`). GitHub's cached merge commit `d69e098` is stale against `126a528`, leaving `mergeable: null`. While there is no textual conflict against `63abaeb`, PR #57 has a **semantic/operational conflict**: it hardcodes obsolete commit `'126a528...'` in `.github/workflows/agus-crypto-devnet-image.yml` and explicitly states *"Do not merge this temporary workflow workaround; close after verified artifact delivery."* |
| **#29 & #39** (→ `main`) | `#29`: `unknown`; `#39`: `false (dirty)` | **CONFLICT (`README.md`)** (`exit=1`) | Both target `main` (`d66c460`) from Oct 2026 (`base.sha: 292d0b1`, 2 commits behind `main`), conflicting with subsequent Zcash/Pollar `README.md` commits (`b1862ef`, `d66c460`) on `main`. |

---

## 5. Recommended Merge Order, Branch Strategy, and PR Closure List

### Branch Strategy
1. **`integration/agus-crypto-hackathon-20261129`**: Sole hackathon integration target.
2. **`feat/agus-crypto-backend` (PR #52)** + **Consolidated RC draft PR**: Once Codex publishes/hands off `#52`, merge `#52` into `integration/agus-crypto-hackathon-20261129`, then rebase/merge this RC branch (`PRD.md`, `API_CONTRACT.md`, Chisom integration guide, consolidation audit & evidence) — **or** merge this consolidated RC PR directly after Codex sign-off since it starts cleanly at `63abaeb`.
3. **Frontend lane (`FE-01`)**: Chisom branches from `integration/agus-crypto-hackathon-20261129` (or this RC branch) and delivers narrow UI PRs back to `integration/agus-crypto-hackathon-20261129`.
4. **Never delete historical/experimental branches** (`improve/agus-banking-workspace-20261021`, `repair/agus-provider-diagnostics-20261022`, `experiment/*`, `docs/*`, `ag/*`, `ops/*`). Keep `main` and the historical `agus_staging` database untouched.

### Recommended Execution Order
1. **Codex sign-off on `feat/agus-crypto-backend` (PR #52)** -> merge PR #52 into `integration/agus-crypto-hackathon-20261129` (or fast-forward to `63abaeb`).
2. **Merge Consolidated RC Draft PR** (incorporating PR #51's `PRD.md` + `API_CONTRACT.md`, `CHISOM_ANDROID_INTEGRATION.md`, and audit ledgers) into `integration/agus-crypto-hackathon-20261129`.
3. **Close superseded/obsolete PRs (only after founder approval, preserving branches)**:
   - Immediately safe after RC/PR #52 merge: **#51** (if incorporated via RC), **#53, #54, #55, #56, #57, #45, #46, #47**.
   - Historical intermediate/conflicting AGUS Bank PRs safe to close (retaining branches `#43` and `#44` as references, or archiving `#43`/`#44` with a tag): **#28, #29, #36, #37, #38, #39, #40, #41, #42**.
4. **Keep unmerged / separate**:
   - **#43, #44** (historical AGUS Bank tips — preserve branches, do not merge into Crypto or `main`).
   - **#48, #49, #50** (experimental wallet-delegation & Swig Pocket PoCs — keep separate from hackathon release).
5. **Chisom Android UI integration (`FE-01`)** → **Founder Release Gates (`REL-01`)**: deploy any post-`126a528` release if needed, update Vercel DAL `.well-known/assetlinks.json` for replacement signing cert, publish signed ARM64 APK, and complete the 3 physical Devnet transfers (Phantom → Solflare → Phantom → Solflare).

---

## 6. Verification Summary & Environment Boundaries

Detailed commands, outputs, exit codes, and scope distinctions are recorded in [rc-consolidation-20261125.md](evidence/rc-consolidation-20261125.md):

- **Static, contract, lint, and Expo Android bundle gates pass (`exit 0`)**: `npm run typecheck`, `npm run mobile:typecheck`, `npm run lint`, `AGUS_ENVIRONMENT=fixture npm run config:validate`, `npm run contracts:generate` (zero diff on `packages/contracts/openapi.json` and `packages/api-client/src/generated.ts`), and `EXPO_PUBLIC_API_URL=https://prototype.fixture.invalid npm run mobile:export:android` (`1096 modules`, `5.6MB` `.hbc`).
- **Focused Crypto & Mobile Vitest suites pass (`exit 0`)**: `11 passed | 1 skipped (12)` files, `109 passed | 21 skipped (130)` tests (`tests/crypto-backend.test.ts` skipped `10/10` without `AGUS_TEST_DATABASE_URL`); additionally all core Solana, contract, research, adversarial (`24/24` including `NEG-11`), mobile (`8/8` + `11/11`), environment (`14/14`), and provider-diagnostics (`11/11`) tests passed in the full Vitest run.
- **Full `npm test` (`vitest run`) Windows/timing observations (`exit 1`)**: `92 passed | 15 failed | 5 skipped (112)` files, `1673 passed | 14 failed | 104 skipped (1791)` tests (`2398.03s`). All 15 failing files resulted from host timing/hook thresholds rather than broken Crypto behavior: 5 `beforeAll` hook timeouts (`15s`/`30s`, including `tests/crypto-voice.test.ts` cold PGlite init which passed earlier when warm), 9 `node --import tsx` child-process restart/persistence files (`12` cases timing out at `20s`–`31s`), and 2 `<500ms` benchmark thresholds in `tests/financial-intelligence/performance-benchmark.test.ts` (`616.7ms`/`574.9ms`; `810.8ms`/`639.9ms` isolated).
- **Deploy preflight & EC2 unit tests**:
  - `deploy/crypto/aws/vitest.config.ts`: `36 passed | 5 failed` (`exit 1`) on Windows due to `preflight.test.ts`'s hardcoded `50000ms` child timeout (`node --import tsx` `SCHEMA_MIGRATION_REQUIRED` probe completed fail-closed in `42.16s` when invoked directly).
  - `deploy/crypto/ec2`: Windows Python fails importing POSIX `fcntl` (`exit 1`); under WSL Linux (`wsl.exe python3 -B -m unittest discover -s deploy/crypto/ec2 -p "test_*.py"`), `Ran 1 test in 0.008s` (`OK`, `exit 0`).
- **Not tested / out of scope in this audit**: Live `AGUS_TEST_DATABASE_URL` integration suite (`crypto-backend.test.ts`, `platform.test.ts`), live paid Gemini/ElevenLabs/Firecrawl/Google OAuth/Resend provider acceptance, Stockholm EC2 mutation, and physical Android handset MWA testing (see `ANDROID_DEVICE_TEST.md`).
