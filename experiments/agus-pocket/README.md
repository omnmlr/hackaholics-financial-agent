# AGUS Pocket local experiment

This standalone Node package uses official Swig Classic 3.0.0, the Solana token SDK and LiteSVM 1.6.2. It generates disposable in-memory signers and synthetic tokens. The test path needs no App ID, private-key input or RPC connection.

From the repository root on Linux x86-64, with Node 20.18 or newer, npm and curl:

```bash
set -euo pipefail
cd experiments/agus-pocket
npm ci --ignore-scripts --no-audit
mkdir -p .artifacts
curl -fsSL \
  https://github.com/anagrambuild/swig-wallet/releases/download/devnet-upgrade-9-c64127837995/swig.so \
  -o .artifacts/swig.so
npm test
```

The harness verifies SHA-256 before loading the ELF. Each run should report three passing tests. Output includes disposable public addresses, signers and local receipts. Leave the ignored program bytes and optional snapshots out of commits.

## Optional Devnet executable comparison

If current Devnet still exposes the same ProgramData and revision documented in the report, obtain its payload using public read-only RPC and save it as `.artifacts/devnet-swig.so`. This reads the finalized ProgramData account and removes the upgradeable loader's 45-byte header:

```bash
curl -fsS https://api.devnet.solana.com \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["Bb6gN8CtkMXf7cfXKnWysmdBg5B8EZfP5kus5TsyH5Es",{"encoding":"base64","commitment":"finalized"}]}' \
  -o .artifacts/devnet-programdata.json
python3 - <<'PYTHON'
import base64
import json
from pathlib import Path

result = json.loads(Path(".artifacts/devnet-programdata.json").read_text())
account = result["result"]["value"]
assert account["owner"] == "BPFLoaderUpgradeab1e11111111111111111111111"
data = base64.b64decode(account["data"][0])
assert int.from_bytes(data[:4], "little") == 3
assert int.from_bytes(data[4:12], "little") == 522994140
Path(".artifacts/devnet-swig.so").write_bytes(data[45:])
PYTHON
npm test -- --devnet-snapshot
```

The optional run checks the historical snapshot's full payload digest. A later Devnet upgrade can make that path unavailable. The pinned release remains the reproducible default. Both test modes execute only in LiteSVM. [Results and limitations](../../docs/agus-crypto/pre-prd/POCKET_PROOF_OF_CONCEPT.md)
