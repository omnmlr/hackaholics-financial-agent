# Dev3pack Global Hackathon · AGUS Crypto

The event runs 27–29 November 2026. Sunday, 29 November is the hard submission date. The organizer publishes the exact UTC cutoff in the accepted-participant dashboard. Check that time before scheduling submission. The written rules permit a team's own pre-existing Solana code, design and research and require the README to identify what was built before and during the event. The submission must be open source and a team may have up to four people. [Official event](https://hack.dev3pack.xyz/) · [Official FAQ](https://hack.dev3pack.xyz/faq) · [Participant dashboard](https://hack.dev3pack.xyz/dashboard)

## Tracks and product evidence

| Official track or partner | Evidence for AGUS Crypto |
| --- | --- |
| Best App Overall on Solana | Every project enters the main track by default. The prize rules require a unique Rust Solana program deployed at least to Devnet, its address in the README and substantial Solana SDK use. Show verified balances and activity, an externally approved transfer, fee, receipt and restart recovery. Link actual explorer signatures and state their cluster. |
| Best Mobile App Built on Solana Mobile | The rules require a native-first Android app, functional APK, Mobile Wallet Adapter, meaningful Solana use, contract addresses and a Solana dApp Store submission. Show Phantom and Solflare connections, explicit wallet approval and receipt recovery on the signed build. |
| Best ElevenLabs Integration | Generate Speech and Transcribe Speech are eligible paths. Show a user speaking, reviewing the Scribe transcript and playing the ElevenLabs synthesis. Gemini grounds financial answers. The track also asks for a public repo, README explaining both integration paths, contract addresses, live link and sub-three-minute demo. The advertised prize is three months of Scale tier per member. |
| Firecrawl | Show a recent public question whose answer cites fetched sources. Display available publication dates and distinguish verified portfolio data from public reporting. Include one minimized query and the returned citation URLs. |

The FAQ allows entry in partner tracks the project genuinely uses, subject to judging. Firecrawl appears among the public partners. The detailed prize page does not list a Firecrawl award. Devnet and Mainnet program addresses are accepted. The founder's Mainnet demonstration depends on completed handset Devnet acceptance and explicit spend approval. [Detailed prize rules](https://hack.dev3pack.xyz/prizes) · [Organizer partners](https://hack.dev3pack.xyz/#partners) · [Official FAQ](https://hack.dev3pack.xyz/faq)

AGUS Crypto currently uses Solana's built-in transaction paths. The repository's legacy Rust escrow is a local Anchor prototype with a placeholder program ID. On 24 November, the public Devnet RPC returned no account for that ID at finalized slot `525834093`. Qualifying for the main prize requires a genuinely deployed Rust program that belongs to the submitted product. Confirm with the organizers how the contract-address field applies to the Mobile and ElevenLabs tracks when a product uses existing Solana programs. [Escrow status](../../escrow/README.md) · [Detailed prize rules](https://hack.dev3pack.xyz/prizes)

Submitting to the Solana dApp Store requires publisher KYC or KYB, a release-signed ARM64 APK, listing assets and public HTTPS pages for the app, terms and privacy policy. The publisher wallet must authorize the App NFT mint and on-chain release submission. The store typically reports a review result within three to four business days. Keep the submission receipt for the Mobile track and verify whether the organizers require store approval by the cutoff. [Publisher portal](https://publish.solanamobile.com/) · [Official submission procedure](https://docs.solanamobile.com/dapp-store/submit-new-app)

## Submission materials

- Project name, one-liner, description, images, team roster and relevant hub, category or program address fields.
- A public demo video strictly under three minutes. Show the real application and the product interactions that support the selected tracks.
- The public source repository and working live link. Include the exact APK release URL and checksum when available. Keep the general product entry point free of evaluator credentials and provide an authorized invite through the expected judging channel when needed.
- Show the judging path in order. Connect the wallets, ask about a transaction or portfolio in one conversation, play AGUS's reply, open its evidence, review a transfer and confirm it in the external wallet. Save the receipt and evidence of recovery.

The organizer scores product and technical quality. Top-100 review includes source inspection and live demo verification. The GitHub repository is public. GitHub identifies no repository-wide license, so confirm the project's licensing scope before submission. Individual components have their own license files. [Official submission requirements](https://hack.dev3pack.xyz/faq) · [Public source](https://github.com/omnmlr/hackaholics-financial-agent) · [Android license](../../apps/mobile/LICENSE)

## Benefits and usage

The organizer documents an ElevenLabs Creator plan offer. The participant can open the ElevenLabs Discord coupon-code channel, select **Start Redemption**, pick the event and use the email they registered with. Live verification used the configured free-plan account, which reported that overages are unavailable. Firecrawl reported remaining account credits and accepted a small search request. The public event pages do not establish a Firecrawl coupon or confirm redemption of the ElevenLabs offer. Check the participant's Perks tab for account-specific eligibility. [Prize and redemption rules](https://hack.dev3pack.xyz/prizes) · [ElevenLabs redemption channel](https://discord.com/invite/VnBvbbcdEC) · [Participant perks](https://hack.dev3pack.xyz/member/perks)

## Evidence locations

- [AGUS Crypto implementation and previous Devnet evidence](IMPLEMENTATION.md)
- [Android signing and physical wallet procedure](ANDROID_DEVICE_TEST.md)
- [Versioned API, citation shapes and integration fixtures](FRONTEND_CONTRACT_1_1.md)
