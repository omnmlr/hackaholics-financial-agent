# Zcash integration audit

Inspected published commit `b9efe96b268444d5e55bb6a81251f82d7f5e77bc` without merging its sender into the deployed app. The handoff is preserved separately as published evidence, not a claim that Counterpart executed it.

The handoff reports transfer `ab7f8db0323414980c8389977587bf43c42e13765616c090dbd1e1d3cf461323`, block 4616326, 0.05 test ZEC and receiver detection of 5,000,000 zatoshis. Its `scripts/verify-zcash-testnet-transfer.ts --evidence` prints a hard-coded record; it does not independently query that receipt. Public lightwalletd block metadata alone cannot prove the hidden amount or receiver.

The actual `src/lib/zcash/wallet-service.ts:344` execution path deducts an in-memory balance and generates `txid_testnet_${randomBytes(32)}` when no supplied transaction ID exists. It has no real signing/broadcast call at that boundary, yet returns wording saying broadcast succeeded. `markFinalized` also changes in-memory state without receiving-wallet evidence at that boundary. This must not be represented as genuine execution in Counterpart.

A real external `zaw`/librustzcash demonstration may have occurred independently. Connecting it safely still requires an authenticated testnet-only sender service, durable one-use terms-bound approval, exact source/recipient/amount/fee/expiry binding, non-retryable submission and independent receiving-wallet verification. No such operational service credentials or wallet access are configured on the acceptance preview. Spending keys must remain in that external wallet.

Counterpart preserves the existing supported Sapling testnet receiving-request flow and verification contract. No sending operation, balance or confirmation from the feature branch is fabricated or promoted into the app. Orchard unified addresses in the reported demo are not silently treated as supported Sapling receiving addresses.
