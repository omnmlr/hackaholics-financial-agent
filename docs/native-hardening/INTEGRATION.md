# Integration candidate and Railway rollback

Candidate: `hardening/agus-native-release-20261020`, draft PR #38, based on exact
PR #37 head `9d10d49f2df6c2c32faf51db3582e79a5e6187dc`. PR #36's useful application,
voice, persistence and payment work remains in its ancestry. No production ref
was modified and no Railway operation was performed.

## What is known about deployment

Remote refs were read through Git. `deploy/agus-render-fixture-20261020` points to
`5f481dad73c737b58c7db819ec7692ecf90aeaa6`; its deployment-specific
`scripts/render-preview-start.mjs` is explicitly a **Render fixture** entrypoint.
It enforces fixture flags, derives the operator hash from an existing runtime
password variable, runs the existing migration entrypoint, and launches Next
with the supplied port. It is not evidence of Railway's active configuration.
`production/agus-demo-film` points to
`e3fc8f22d040ab8b2fff339dccdc364262ae268d` and is older application history; the
name alone also proves nothing about Railway.

No Railway config file is tracked at PR #37's head, and no connected Railway
management capability or service credential is available. The GitHub connector
also rejected its deployments collection as unsupported. The active Railway
service, branch, deployed SHA, start/build commands, runtime, volume mount and
non-secret variable inventory therefore remain **unverified**. No live URL was
used as an excuse to perform production operations.

## Concrete integration procedure after review

1. In the existing Railway service, record the deployed SHA and connected branch,
   exact build/start commands and startup file, Node runtime, healthcheck, volume
   mount and variable **names**. Do not print values. Confirm whether pushes to a
   branch trigger automatic deployment before pushing any integration branch.
2. Create an isolated integration branch from that verified deployed commit.
   Integrate the reviewed PR #37 ancestry and PR #38 repairs into that branch.
   Review deployment-specific conflicts explicitly. The hardening candidate is
   ready for this source integration; it is not falsely presented as a branch
   already reconciled with an unknown deployed Railway SHA.
3. Preserve the real service's startup file and command verbatim. In particular,
   the Render-only startup file is absent from PR #37's source branch; blindly
   replacing a deployment tree could delete it. If the actual service uses a
   deployment-specific file, retain that file rather than copying another
   platform's bootstrap. Compare its exact contents to the deployed commit.
4. Preserve existing `DATABASE_URL`, TLS configuration, persistent volume,
   operator identity/password configuration, session configuration, `APP_ORIGIN`,
   port binding and reconciliation/webhook settings. Keep `PAYMENT_MODE=fixture`,
   `FINANCIAL_DEMO_ENABLED=true`, and all live transfer flags disabled. Do not
   reseed, reset, migrate production data, rotate credentials or enable a bank
   connection as part of preparation.
5. PR #38 adds no dependency, schema or startup change relative to PR #37. The
   complete candidate needs PR #37's pinned `@google/genai@2.30.0` and
   `decimal.js@10.6.0` plus its lockfile. Use `npm ci`. Next requires Node >=20.9;
   local validation uses Node 24. Keep an already compatible Railway runtime.
6. Run typecheck, lint, unit/integration tests, production build, HTTP smoke,
   `npm run test:browser`, and `node scripts/browser-native-agent.mjs` against
   disposable fixture storage only. Review the genuine evidence separately from
   scripted browser responses. Reopen saved conversations and editable payment
   drafts and verify no chat action approves/submits anything.
7. After source review and deployment authorization, use the existing operator
   release process. This document does not authorize or perform deployment. The
   current work stops at a reviewable candidate and evidence.

## Enable and roll back

`AGUS_AGENT_ARCHITECTURE=native-gemini` opts into the native candidate. With that
variable absent or set to `baseline`, the inherited PR #36 agent handles chat.
It is server-only; requests cannot choose an architecture, key or model.

Use the existing server `AI_PROVIDER=gemini`, `AI_API_KEY` and an available
`AI_MODEL`. The Actions secret `AGUS_GEMINI_API_KEY` is mapped only inside the
isolated verification job; it is not a new deployment variable or a value to
export into the workspace. No secret changes are needed for these source edits.

Rollback after any later authorized release: remove the architecture selector
or set `AGUS_AGENT_ARCHITECTURE=baseline`, then use the service's existing restart
mechanism. No database rollback or record deletion is required. If code rollback
is necessary, restore the recorded known-good commit while preserving the same
database, volume, environment and startup file. Never replay, approve or submit
a saved payment as a rollback test. Keep a record of uncertain transfer outcomes
for the existing reconciliation process.

Until the actual Railway configuration is verified, this is an integration plan
with explicit unresolved prerequisites, not a deployment-ready claim about the
running service.
