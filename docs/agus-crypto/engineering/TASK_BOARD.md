# AGUS Crypto task board — November 24–29

Read [CONTROL_PLANE.md](CONTROL_PLANE.md) before starting. All statuses below refer to evidence available at the pinned checkpoint; recheck before changing them. Coordination branch is documentation-only; no release approval is implied.

## Immediate assignments

| ID | Owner | Priority | State | Editable scope |
|---|---|---|---|---|
| AG-01 | Antigravity | P0 | READY | New AWS deployment tooling and documentation; no cloud mutations |
| AG-02 | Antigravity | P0 | READY | Read-only Android/MWA investigation and standalone regression evidence; no signing identity changes |
| AG-03 | Antigravity | P0 | READY | Read-only financial security audit, isolated adversarial tests; no changes to authorization or execution paths |
| CX-01 | Codex | P0 | INTERRUPTED / UNPUBLISHED | Existing multimodal, sponsor and contract implementation; publish safe checkpoint first |
| OP-01 | Founder + ChatGPT | P0 | BLOCKED ON ACCOUNT ACCESS | AWS billing/region/domain verification, secure owner-run signing procedure |
| FE-01 | Chisom | P0 | REMOTE IMPLEMENTATION NOT OBSERVED | Android UI/UX, existing contract and fixtures, design and integration; request current branch/design |
| RV-01 | ChatGPT / independent reviewer | P0 | READY ON HANDOFF | Review PR diffs and independently reproduced evidence; no self-approval |
| REL-01 | Founder + Codex | P0 | BLOCKED | Devnet APK, physical wallet acceptance, integrated Android demo |
| REL-02 | Founder + Codex | P0 | GATED | Small real Mainnet demo after REL-01 and explicit authorization |

### AG-01 — Reproducible AWS deployment package
Branch: `ag/aws-devnet-preflight-20261124` (from coordination branch; fresh fetch first).
Read existing `deploy/crypto/Dockerfile`, `deploy/crypto/start.sh`, `scripts/crypto-devnet.ts`, `docs/agus-crypto/DEVNET_DEPLOYMENT.md` and [AWS preflight](AWS_PREFLIGHT.md). Implement isolated new tooling under `deploy/crypto/aws/` and documentation only. Prove build and container configuration locally with disposable DB/fixtures as appropriate. Prepare one EC2 host running API + worker, HTTPS reverse proxy, persistent restart policy, pinned release revision/image, private runtime secrets, restricted DB role and rollback. Supply cost formula/official rates for selected region and sizing measurements; no speculative credit balance. Prove fail-closed checks for absent secrets, wrong cluster, mismatched origins, uninitialized DB and unsuccessful readiness. Avoid logging environment dumps. No provisioning, external DNS changes, deployment to live account, plan upgrades or new credentials. If actual AWS account access is absent, report exact owner actions and stop at preflight. Keep Railway fallback staged. Do not edit shared API, provider, migration or signing code.

### AG-02 — Android and external wallet evidence
Branch: `ag/android-wallet-audit-20261124`. Inspect `apps/mobile/src/crypto-signer.ts`, `apps/mobile/src/crypto-device-state.ts`, `apps/mobile/src/crypto-wallet-policy.ts`, `apps/mobile/tests/crypto-mobile.test.ts`, Android workflow, manifest, [handset procedure](../ANDROID_DEVICE_TEST.md), and PR #47 prior device evidence. Verify installed MWA package/version and consult version-matched upstream documentation. Trace ownership, review bytes, cancellation, teardown, activity recreation, lost callback, duplicate prevention and app/HTTPS identity. Produce a diagnosis matrix distinguishing confirmed bug, plausible cause and device-only uncertainty, with source lines and reproduction steps. Add isolated regression tests only if feasible without modifying active implementation or shared tests. Do not generate a key, alter DAL, disable wallet warnings, request seed phrases, sign transactions, or claim a phone test. Report the least invasive suggested fix separately.

### AG-03 — Adversarial security and reliability audit
Branch: `ag/crypto-security-audit-20261124`. Inspect registry, API route, execution, ledger, portfolio, alerts, session auth and least-privilege SQL in the pinned baseline. Build a concise threat model and reproduce high-value negative cases in disposable local tests: cross-tenant wallet/attempt access, wrong cluster/signer, tampered review digest or bytes, expired proof, changed amount/recipient, repeat handoff, missing callback, false finality, replayed alerts, stale/partial data. Inspect legacy credentials and Devnet profile fail-closed behavior. Keep findings prioritized by severity and reproducibility, with file/line evidence, commands and remediation proposal. New standalone tests only; no rewrite of active backend or reduction in safeguards. Never run against production accounts or submit transactions. REA is optional only if real tool access verified. Do not invent vulnerabilities; explicitly mark inconclusive checks.

### CX-01 — Preserve interrupted Codex work
When usage returns, first inspect git status/diff and agent outputs. Checkpoint coherent safe changes on existing Codex-owned branch or dedicated continuation branch, preserving commits and tests; report actual head and PR. No blind reset or another broad subagent run. Then report each provider, image, research, audio, contract, AWS and Android criterion individually, including blockers; continue highest-impact missing P0. Independent reviewers compare the new head against the baseline before any overlapping Antigravity tasks are reassigned.

### OP-01 / REL-01 — Founder prerequisites
- Verify actual AWS plan, remaining credit and eligible EC2 region; read-only first. Select a stable hostname and authorize exact cost envelope and deployment, then provide scoped access. No root credentials.
- Run existing `scripts/android/prepare-release-signing.sh` in a trusted owner-controlled environment with recoverable encrypted backup. Only the public certificate fingerprint is shared. Use the existing guide; do not place signing material in Antigravity.
- After verified hosted API, update DAL and configure device API URL; publish signed ARM64 APK plus verified SHA-256; run the physical wallet sequence in the control plane.

### FE-01 — Frontend integration
Request actual current branch/commit or design screenshots, not a progress percentage. Use existing typed contract/fixtures until live API is ready; coordinate additive multimodal contracts after CX-01 handoff. Preserve approved logo and Chisom's ownership. Test full screen-to-wallet-to-receipt flow when APK is ready.

## Independent review rule
Every task has one implementer and a separate reviewer. The reviewer must inspect actual diff, reproduce representative tests and record unmet criteria. Submit small evidence-bearing draft PRs; do not combine multiple unfinished workstreams into a single claim. No auto-merge. User-facing success remains gated on physical and hosted evidence.
