<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## AGUS Crypto delivery coordination (November 24–29, 2026)

For the hackathon Crypto work, read [the engineering control plane](docs/agus-crypto/engineering/CONTROL_PLANE.md) and [task board](docs/agus-crypto/engineering/TASK_BOARD.md) before changing code. These supplement, not replace, the Next.js rules above. The approved product and wire contracts are in PR #51; use the pinned document links in the control plane, not an invented replacement specification. Explicit founder decisions supersede older release assumptions.

- Start by recording exact base SHA, working tree status and task ownership. A separate task branch/worktree is mandatory; never overwrite, reset, force-push, merge or clean another agent's work. PR #52 may contain unpublished Codex work; do not implement overlapping changes until its owner publishes and hands off.
- For any completion claim, produce a commit, changed paths, actual commands and exit codes, and redacted evidence. Distinguish implementation, local tests, live provider calls, deployment, and physical-device acceptance. A test skip, unavailable tool or mock never proves real functionality. Do not silently retry or weaken an acceptance gate to manufacture a pass.
- Prefer narrow changes and focused regression tests during development; full Foundation CI at integration checkpoints. Inspect existing implementation before adding abstractions or dependencies.
- Use REA if actually callable; record the real tool/version and findings, or explicitly state unavailable. Independent review must challenge claims using source, reproducible tests and live evidence where authorized; agent agreement is not proof.
- No secrets in repo, prompts, logs or artifacts; no unrestricted AWS credentials, real-money transactions, production deploys, standing wallet authority, credential rotation, permanent signing-key changes or destructive data operations without specific founder authorization. Devnet is the only execution environment for independent tasks.
- Preserve the approved mascot/logo, Chisom's frontend ownership and the existing generated client contract. Marketing website is last. No guest mode; preserve Google/email identity and per-user authorization.
- AWS/Neon is the preferred hosting candidate subject to verified credits and authorization. Railway staged changes are fallback only; do not activate them. Do not touch the historical AGUS Bank database.
- On interruption, checkpoint safe code on your own branch, record blocked work and handoff evidence; never commit private credentials, incomplete secrets or fake results. Do not change the integration target without explicit reviewer approval.
