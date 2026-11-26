#!/usr/bin/env bash
# Run in Ubuntu under WSL 2 on the trusted Windows signing workstation.
set -euo pipefail
umask 077
set +x

repo=omnmlr/hackaholics-financial-agent
origin=https://13-48-206-202.sslip.io
identity=https://agus-wallet-devnet-identity.vercel.app
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

stop() { printf '%s\n' "$*" >&2; exit 1; }

[[ -t 0 ]] || stop 'Run in an interactive Ubuntu terminal under WSL 2.'
command -v gh >/dev/null || stop 'Install GitHub CLI in Ubuntu and sign in with gh auth login.'
gh auth status --hostname github.com >/dev/null 2>&1 ||
  stop 'Sign in as a repository maintainer with gh auth login --hostname github.com --web.'

if [[ "${1:-}" == --release ]]; then
  [[ $# == 2 && $2 =~ ^[0-9]+$ ]] || stop 'Usage: bash prepare-release-signing-windows.sh --release GITHUB_RUN_ID'
  for tool in curl jq; do
    command -v "$tool" >/dev/null || stop "Install $tool inside Ubuntu on WSL."
  done
  run_id=$2
  gh run view "$run_id" --repo "$repo" --json workflowName,headBranch,headSha,status |
    jq -e '.workflowName == "AGUS Crypto Android Devnet APK" and .headBranch == "feat/agus-crypto-backend" and .status == "completed"' >/dev/null ||
    stop 'Select a completed Android Devnet workflow run from feat/agus-crypto-backend.'
  safe_get() { curl --proto '=https' --fail --silent --show-error --max-time 20 "$1"; }
  safe_get "$origin/api/v1/ready" | jq -e '.status == "ready"' >/dev/null ||
    stop 'The Stockholm API did not pass public readiness.'
  safe_get "$origin/api/v1/openapi" |
    jq -e '.paths["/api/v1/crypto/attempts/{id}/handoff"].post' >/dev/null ||
    stop 'The Stockholm API did not serve the expected Crypto contract.'
  fingerprint=$(gh variable get AGUS_ANDROID_CERT_SHA256 --repo "$repo" | tr -d '[:space:]')
  [[ "$fingerprint" =~ ^[a-fA-F0-9]{64}$ ]] || stop 'Run signing preparation first.'
  safe_get "$identity/.well-known/assetlinks.json" |
    jq -e --arg sha "${fingerprint^^}" 'any(.[];
      (.relation | index("delegate_permission/common.handle_all_urls")) != null
      and .target.namespace == "android_app" and .target.package_name == "app.agus.prototype"
      and any(.target.sha256_cert_fingerprints[]?; (gsub(":"; "") | ascii_upcase) == $sha))' >/dev/null ||
    stop 'Update Vercel Digital Asset Links with the replacement public certificate, then retry.'
  gh run view "$run_id" --repo "$repo" --json headSha --jq '.headSha'
  read -r -p 'Type RELEASE to configure the API URL and rerun this Android job: ' confirm
  [[ "$confirm" == RELEASE ]] || stop 'Release was cancelled.'
  gh variable set AGUS_CRYPTO_DEVICE_API_URL --body "$origin" --repo "$repo"
  gh run rerun "$run_id" --repo "$repo"
  printf 'Android run queued. Check the verified APK and checksum in GitHub Releases.\n'
  gh run view "$run_id" --repo "$repo" --json url --jq ' .url'
  exit
fi

create=false
if [[ "${1:-}" == --create ]]; then
  create=true
  shift
fi
[[ $# -le 1 ]] || stop 'Usage: bash prepare-release-signing-windows.sh [--create] [encrypted-backup-path]'
for tool in git gpg keytool openssl; do
  command -v "$tool" >/dev/null || stop "Install $tool inside Ubuntu on WSL."
done
backup="${1:-}"
if [[ -z "$backup" ]]; then
  read -r -p 'Absolute WSL path to the encrypted replacement backup: ' backup
fi
[[ "$backup" == /* ]] || stop 'Use a WSL absolute path such as /home/you/... or /mnt/c/...'
if [[ ! -f "$backup" ]]; then
  [[ "$create" == true ]] || stop 'Backup does not exist. Locate it first or explicitly run with --create.'
  read -r -p 'Type CREATE only if no replacement backup exists: ' confirm
  [[ "$confirm" == CREATE ]] || stop 'Signer creation was cancelled.'
fi
gpg --list-secret-keys --with-fingerprint
read -r -p 'Encryption-capable GPG recipient fingerprint, without spaces: ' recipient
export GPG_TTY
GPG_TTY=$(tty)
[[ -d /dev/shm && -w /dev/shm ]] || stop 'The WSL memory-backed temporary directory is unavailable.'
export TMPDIR=/dev/shm
cd "$script_dir/../.."
bash "$script_dir/prepare-release-signing.sh" "$backup" "$recipient"
printf '%s\n' 'Keep a second encrypted copy in approved recovery storage.' \
  'Share only the public certificate SHA-256 for the Vercel association.' \
  'After the HTTPS API and Vercel association are ready, run this script with --release GITHUB_RUN_ID.'
