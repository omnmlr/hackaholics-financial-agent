# Wallet verification · November 24, 2026

AGUS now seeds its bounded token history from finalized classic SPL ownership metadata as well as currently open token accounts. A closed account can be discovered when the wallet’s existing history includes a transaction that identifies its owner. The scanner follows newly discovered accounts on later passes. It links a token-feed event only when that event identifies the wallet’s ownership, which excludes activity after an authority change. The same finalized signature still appears only once across feeds and wallets. RPC history, the seven-day window and unobserved token accounts limit coverage.

Mainnet watch-only portfolio reads value native SOL and canonical classic SPL USDC using observed Coinbase USD spot quotes. The quote, observation time and exact decimal valuation are included for each priced holding. The priced subtotal covers those holdings and preserves separate balance and price coverage. Devnet assets and unsupported tokens remain unpriced. On November 24 at 16:19 WAT, a live application check observed `1933483974904` lamports for the public wrapped SOL mint account, at finalized portfolio slot `473392125`. The observed quote was `$68.635` per SOL and the derived SOL holding value was `$132704.67261753604`. These were timestamped observations. [Coinbase spot price documentation](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices)

The worker can release a lost callback after blockhash expiry when two independently operated Devnet RPCs agree on a sufficient finalized sender history and on the different transaction bytes for every reviewed candidate. If either provider falls short of the evidence threshold, AGUS keeps the attempt unresolved. That preserves the active duplicate guard across callbacks and restarts.

## Confirm the three handset receipts

Run through the physical test with a signed AGUS build and two separately controlled disposable Devnet addresses. Preserve the immutable review JSON and finalized receipt JSON for each transfer. First connect Phantom and Solflare and prove both addresses. Sign `0.001 SOL` in Phantom for Solflare, reverse it in Solflare, then force-stop and reopen AGUS. Record the restored attempt and receipt before signing the third `0.001 SOL` transfer in Phantom. Save the three entries in order as a local JSON array of objects with `review` and `receipt` properties. Keep session credentials and any device recovery secrets out of the file. [Handset procedure](ANDROID_DEVICE_TEST.md)

```bash
AGUS_DEVNET_VERIFY_RPC=https://devnet.rpcpool.com \
  node --import=tsx scripts/android/verify-wallet-receipts.ts \
  --input /path/to/handset-receipts.json \
  --output /path/to/verified-handset-receipts.json
```

Use a verifier operated independently of `AGUS_DEVNET_RPC`. The verifier pins both endpoints to Devnet, checks that the three signatures and review references are distinct, and compares the ordered counterparties, reviewed message digests, finalized slots, fees and exact pre/post lamport changes with AGUS’s receipts. Each sender’s balance must decrease by `1000000` lamports plus the fee. Each recipient’s balance must increase by `1000000` lamports. The command performs read-only RPC calls and writes a new evidence file.

Record device model, Android version, both wallet app versions, each wallet’s approval, and the recovered receipt separately on the handset. The transfers are internal when both addresses belong to the same verified AGUS user. An external-inflow rule therefore should stay quiet for these three transfers. Capture existing inbox persistence across the restart and the classification of each transfer beside its receipt.

## Mainnet, swaps and Pocket

The Mainnet transaction gate is still closed. After the signed handset passes Devnet, document the dedicated demo sender and recipient, exact amount, fee ceiling and any rent, then obtain separate founder approval before enabling the bounded execution route. A verified finality record and receipt will be required for the Mainnet demo. The watch-only price evidence above exercises a different path.

Jupiter swaps need a separately verified quote and transaction pathway with exact mint and token-account validation, maximum slippage and minimum output bound to a fresh review, and confirmation of actual on-chain effects. Swig Pocket needs separate proof of the Pocket program and authority model, with explicit scoped funding and a tested revoke/withdraw path. No swap execution or standing Pocket permission was enabled for the Devnet acceptance work. [Backend acceptance gates](IMPLEMENTATION.md)
