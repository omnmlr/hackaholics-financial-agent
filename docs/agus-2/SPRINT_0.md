# Sprint 0 — verified integration foundation

Executed 10 November 2026 in `/workspace/agus2-integration`, branch
`integration/agus2-foundation-20261110`, from the approved exact commit
`3f767d17e35efb8e84a9fe4da05f231c8e6956b4`. The original `work` checkout
and existing deployment arrangements were preserved. No branches were merged,
published or deployed.

The approved plan is retained in [APPROVED_ENGINEERING_PLAN.md](APPROVED_ENGINEERING_PLAN.md).
[The capability manifest](evidence/capabilities.json) records provenance,
accepted functionality, excluded alternative executors, and external gates.
The alternative autonomous executor and merchant-message adapter remain absent
from the integration runtime. Intelligence behavior is preserved.

## Changes

- Password verification consumes an atomic persistent database attempt counter
  before checking the password. Financial reauthentication has a per-owner
  ten-attempt/15-minute budget shared by Solana, batch approval and OTP routes.
  Changing draft IDs, sessions, or restarting the process cannot reset it.
  Reauthentication does not create an additional login session.
- Existing Solana owner, exact-digest, simulation, expiry, signing and durable
  submission checks remain in the service boundary.
- Explicit `AGUS_ENVIRONMENT` profiles separate fixture, provider sandbox,
  public Devnet and future live merchant payouts. `npm run config:validate`
  checks the selected profile without exposing credentials. When explicitly
  selected, both payment configuration and the Solana gate enforce it.
  Legacy deployments can omit this setting during migration; their existing
  configuration and live-execution gates remain in force. New profile examples
  and runners select it explicitly. No source-bank access is enabled.
- PR CI tests the current PR checkout without provider/model secrets or persisted
  GitHub credentials. Installation precedes an IPv4/IPv6 external-egress deny
  during checks; local HTTP fixtures remain available. Existing release workflows
  are preserved. The new workflow has been reviewed locally; a hosted GitHub run
  requires publishing this branch and is not claimed here.

## Local verification

Node 24.19.0; pinned dependencies installed with `npm ci --ignore-scripts`.
Checks requiring subprocesses/local sockets ran with environment execution
permissions. Financial and model operations in automated checks are fixtures.

| Check | Result |
| --- | --- |
| Existing regression suite | 69 files, 1,386 tests passed |
| Full suite with Sprint 0 additions | 72 files, 1,405 tests passed |
| New route, environment and restart regressions | 19 passed |
| TypeScript | Passed |
| ESLint | Passed |
| Production Next.js build | Passed |
| Payment HTTP safety smoke | Passed: login, verification, approval, explicit submit, duplicate rejection, reconciliation, persisted status and export |
| Workspace HTTP + Chromium | Passed: ownership, task approval, stale revisions, memory, recovery, mobile-browser routes, disabled Devnet |
| Solana follow-up HTTP + Chromium | Passed with fictional submitted draft; zero chain/model calls |
| Automatic reminder runner HTTP + Chromium | Passed: one approved reminder delivered; no provider/chain calls |
| Strict fixture configuration command | Passed: banking simulated, Solana disabled, accepted source institutions 0 |
| Diff whitespace check | Passed |

Logs are retained for this execution at `/tmp/agus2-{baseline-tests,sprint0-tests,
sprint0-targeted,typecheck,lint,build,http,workspace,followup,runner}.log`.
The restart regression uses independent processes against the same on-disk SQL
database and confirms that a valid password remains blocked after ten concurrent
invalid attempts. Route coverage confirms session replacement cannot evade the
limit and unauthenticated/wrong-origin/wrong-owner requests acquire no approval.
Existing core tests reject stale digests and expired approvals.

## Next gate

Sprint 1 genuine acceptance requires an owner-controlled wallet connection and
signature, first SOL and then canonical Circle test-USDC on Devnet. Fixtures,
read-only RPC observations, and browser tests do not satisfy that gate. No escrow
or advanced swaps may precede it. Sprint 2 depends on Sprint 0 and can be developed
independently, but must preserve the genuine Sprint 1 flow when accepted; native
and later acceptance remain separately gated.
