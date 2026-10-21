# AGUS next release

Baseline: PR #42 head `ca9994b8c0dedb0ba02e50b9d00308e96a28d277` (verified through GitHub and fetched). Branch: `improve/agus-banking-workspace-20261021`; intended PR base: `improve/agus-intelligence-motion-20261021`. PRs #41/#42 are still draft/open, despite their releases being deployed. Never use the older workspace `work` branch as a baseline.

## Current checkpoint: Phase 1 implementation

Investigation: fixed Oct 17 summary is expired independently in fixture.ts and tools.ts. Historical transactions are deliberately partial and do not reconcile to that summary. Durable fm_* storage seeds once with `agus-fictional-ng-v1`; it must remain untouched. Payments use an independent provider wallet, explicit review/approval/submission and CAS workflow_state. Native Gemini preserves bounded dialogue but cannot currently combine financial facts with savings output; unreviewed calculation fallback leaks a questionable result. Previous genuine-provider campaign exhausted its 48-request budget and exposed false narration-review rejections.

Plan: preserve historical rows and seed. Capture explicit fictional opening snapshots into an optional workflow JSON extension; project only newly linked, human-authorized fixture payments as supported changes. Use existing atomic CAS storage (no SQL migration), distinct simulation/state timestamps, explicit unreconciled historical coverage. Unknown accounts stay unknown; ordinary historical/real-source balances retain freshness checks. Bound new payment debits to the operator's authorized fictional source and keep legacy payments separate. Verify persistence, consent, idempotency and pending/failure/reversal semantics before Phase 2.

Then: validate savings quantities/cadence before execution, retain structured planning assumptions without persisting balance authority, reread balances for follow-ups, preserve independent review for general math/financial prose. Explore desktop conversation arrangements, preserve welcome, implement and inspect actual captures. Diagnose mobile viewport behavior, verify shrinking/restoration and motion. Finish integrated engineering/browser checks and one reviewable PR. No merge/deploy/production changes.

Environment: managed cloud runtime skill read; no configured provider/database secrets reported. Dependency installation uses a disposable /tmp npm cache. Local verification only until genuine-provider credentials and a separately bounded budget exist. No bank calls are authorized.

Next action: implement and test opening-snapshot/payment projections against disposable embedded PostgreSQL, then checkpoint Phase 1. Final acceptance and visual reports will live here.
