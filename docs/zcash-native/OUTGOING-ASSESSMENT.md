# Outgoing signer assessment after real receiving acceptance

No outgoing ZEC endpoint was enabled or tested as an AGUS send. The receiving daemon stays locked; the HTTP boundary forwards neither `/api/owner/*` nor `/api/agent/bills/*/pay`. Authenticated negative tests return 404 for these routes. No funds from the new receiving wallet were spent.

The pinned `zaw` source already has a candidate native signing boundary. `src/policy.rs` binds approval ID, network, bill ID, exact address, amount, memo bytes, maximum fee, expiry and uses=1 in canonical bytes with an HMAC derived from seed-held authority. `owner_approve` requires the wallet password. Native operation recovery marks interrupted builds as requiring an owner check, rather than retrying a possibly-broadcast transaction.

This is useful reviewed source, not proof that an AGUS signer is connected. Enabling it would require a separate authenticated owner-review boundary, exact terms displayed before approval, durable single-use claims bound to Counterpart's payment records, explicit user approval for the actual recipient/amount/fee/expiry, native proving resource acceptance under the current 1 GiB service cap, and independent receiving-wallet settlement checks. The seed/viewing credentials must remain outside Counterpart/Gemini. Do not expose the native owner's generic RPC/API or unlock the receiving process to make a demo send.

The verified receiving path has priority. The original TypeScript simulated sender remains unused. A future signer should be independently provisioned and accepted without changing this receiving service's authority.
