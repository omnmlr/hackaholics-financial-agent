# AGUS Mobile Test

**Decision, 2026-11-26.** Continue with a local-first release check for wallet-dependent Solana Android apps. Keep the financial app available as a test target and fallback. Branch base is clean remote `main` at `1b56459d187594b2f83e0e35cc2cf3f10187e894`. This research and implementation own `packages/mobile-test` and `docs/mobile-test`. The financial product and its deployment files are outside the pivot scope.

| Document | Contents |
| --- | --- |
| [Research](RESEARCH.md) | Pinned upstream code, competitors, product gate, commercial hypothesis |
| [Repository audit](REUSE.md) | Existing AGUS components and reuse decisions |
| [Architecture](ARCHITECTURE.md) | Engine, reliability, compatibility and phased plan |
| [Chisom’s integration contract](FRONTEND.md) | Navigation, transport, schemas, fixtures and branding |
| [Execution and demo](DEMO.md) | Evidence classifications, reproduction, demo sequence and blockers |

The local CLI and MCP server are in [the runner package](../../packages/mobile-test). Their current transports provide trusted local operation. Hosted API, tenant isolation, provider enrollment and hardware verification require follow-up work.

Avoid setting a prize or commercial expectation from the public rules alone. The Dev3pack organizer page confirms the November 27–29 date and university hackathon context. Pre-existing projects are permitted per the founder’s confirmation. [Dev3pack](https://hack.dev3pack.xyz/)
