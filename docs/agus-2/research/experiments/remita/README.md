# Remita offline wire-contract audit

Observed 9 November 2026. This is **static source/specification inspection**, not SDK execution, a mock transfer, provider access or bank connectivity.

- `sources.json` records public source URLs, repository-pinned revisions, byte counts and SHA-256 hashes. The Postman documentation URL is mutable; the hash identifies the snapshot inspected, not a guaranteed future download.
- `contract_audit.py` reads already downloaded files, checks their hashes and extracts implementation fields/methods. It has no HTTP client and executes no third-party source.
- `observed-result.json` preserves the actual audit output, including the source hashes. No keys, passwords, customer account details or provider responses are included.

To reproduce, download the five **public source/documentation** URLs in `sources.json` into a separate cache directory using the manifest keys as filenames, then run from the repository root:

```sh
python docs/agus-2/research/experiments/remita/contract_audit.py --cache-dir /path/to/source-cache
```

The run against the inspected cache exactly matched `observed-result.json`. If the public Postman collection changes, the script intentionally stops at the hash check; review the new contract rather than silently attaching old findings to new bytes. Third-party source snapshots are not redistributed here; inspect repository licence terms before copying SDK code into AGUS.

What this proves: the inspected SDK serializes explicit source/destination fields, its older PHP gateway omits README-promised linking methods, and the inspected enquiry returns identity fields. What it cannot prove: server-side source-account permission, modern consumer linking, balance/history access, 20-bank coverage, prices or a successful payment.
