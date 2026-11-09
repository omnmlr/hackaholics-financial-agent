# Dev3pack engineering decisions — checked 9 November 2026

Public primary source: [official event FAQ](https://hack.dev3pack.xyz/faq). [Extracted public answers](../evidence/dev3pack-public-faq-20261109.json) were recovered from the site's publicly served FAQ JavaScript. This is a dated snapshot, not a substitute for the accepted participant dashboard or final terms.

- 27–29 November 2026; submission Sunday 29 November, exact UTC cutoff in participant dashboard. Remote attendance permitted. Teams 1–4; Francis/Gerald fit that public size rule. Individual acceptance/eligibility has not been verified from authenticated records.
- Prior code/design/research permitted when related to Solana. Own pre-existing Solana work must be distinguished from event work in the README. Preserve dated Git history rather than implying AGUS was created over the event weekend.
- **Open source is mandatory.** AGUS remains private under the founder's instruction. Owner approval and a scope/license/security review are required before any public release. A private-only submission would conflict with this published requirement; do not assume Colosseum's separate private-repository allowance applies here.
- AI-generated code allowed when the team owns, understands and can explain it. No submitting another team's hackathon project as our own.
- Form requests project details (including contract address), images, demo/repo/live links, and team. Both devnet/mainnet addresses accepted. A custom program requirement is not established by the public FAQ: clarify in participant resources before inventing an unnecessary program or putting a wallet address in a program field.
- Product/technical review includes real-world impact, product clarity, repo quality, deployment, SDK/Solana depth and live demo verification. No numeric scoring weights verified. Video under three minutes is a strict eligibility requirement; do not substitute slide preparation for product work.
- Partner tracks/prizes are not yet established by this public FAQ. No Solana Mobile track qualification is claimed. Perks require owner activation; no credits were claimed or assumed available.

## Bounded lessons that change engineering

[Superteam's winners directory](https://superteam.fun/build/past-hackathon-winners) is public, but its project list was not recoverable in the fetched document. The supplied [Agent Hackathon projects URL](https://colosseum.com/agent-hackathon/projects) returned a 404; it is not evidence of an empty competition. [Colosseum's March 2026 winners account](https://blog.colosseum.com/agent-hackathoin-ptoken-seeker-grants/) identifies AgentOS and Clude among winners; awards alone do not verify reliability. No competitor backend was independently executed.

[Neur](https://github.com/NeurProjects/neur-app) (MIT, repository README inspected) is a close public Solana copilot: chat persistence, tool components, wallet operations and memory overlap AGUS. Its README mixes features and roadmap, so do not equate every checkbox with verified functionality. [Solana Agent Kit](https://github.com/sendaifun/solana-agent-kit) (Apache-2.0) exposes extensive blockchain actions; a large tool catalog alone would not distinguish AGUS, and importing it wholesale would enlarge permissions/dependencies.

Decision: complete a useful closed loop—intent, attributed context, bounded tools, inspectable proposal, explicit approval, user-held signing, independent outcome evidence, persistent follow-up. This checkpoint implements compound tools and saved review cards rather than adding trading/token-launch features. An approval or model sentence never proves completion. Competitive positioning remains a hypothesis until genuine provider/wallet acceptance succeeds.

## Selective tooling

- Apply the [official Solana skill](https://github.com/solana-foundation/solana-dev-skill/blob/c9da2624cc6baca5c8c2123ea50d92ef19f1c917/skills/solana-dev/SKILL.md), v2.8.0, MIT. Source read from that pinned commit; not globally installed. Its pre-signing simulation guardrail directly resulted in a code/test change. Existing web3.js is retained behind the adapter; no Kit migration without a measured benefit. Historical drafts remain readable/reconcilable, but unsimulated drafts cannot acquire new signing authority.
- [Wallet Standard / Mobile Wallet Adapter web docs](https://docs.solanamobile.com/get-started/web/apps.md): meaningful next increment is Android Chrome/PWA wallet connection, preserving exact-message signing. iOS has no MWA support; injected desktop wallets do not prove Android compatibility. Adopt as a subsequent bounded interoperability task with actual device acceptance. No separate Android app or claim of Seed Vault access.
- [Colosseum Copilot](https://colosseum.com/copilot) is a research skill with sign-in/PAT setup. Public page reviewed; not authenticated or installed, and not needed to unblock implementation.
- [x402](https://solana.com/x402) pays for HTTP resources. Defer: no approved paid endpoints or delegated spending authority at ₦0. Never auto-pay a 402 response.
- [Templates](https://solana.com/developers/templates) are reference implementations, not a reason to replace the existing app. Solana Pay/deep links may later improve receiving/request UX; they do not replace transaction inspection or reconciliation.
- Keep the pinned public devnet RPC for development, with bounded failures and no blind resends. QuickNode/Firecrawl offers are unclaimed; no credential, credit, unlimited usage or paid fallback is assumed.
