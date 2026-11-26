#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 4 && $# != 5 ]]; then
  printf '%s\n' 'Usage: bash scripts/android/verify-devnet-apk.sh APK CERT_SHA256 API_ORIGIN IDENTITY_ORIGIN [SHA256SUMS.txt]' >&2
  exit 2
fi

apk="$1"
fingerprint="${2//:/}"
fingerprint="${fingerprint^^}"
api_origin="${3%/}"
identity_origin="${4%/}"
checksums="${5:-}"
retired_fingerprint=85AD785DFF4A95D38DFA0E5799335E60D7A19266284BB0FFE062058FE7D8B7CF

if [[ ! "$fingerprint" =~ ^[0-9A-F]{64}$ || "$fingerprint" == "$retired_fingerprint" ]]; then
  printf '%s\n' 'Use the SHA-256 fingerprint of the approved release certificate.' >&2
  exit 1
fi

node --input-type=module - "$api_origin" "$identity_origin" <<'NODE'
const [api, identity] = process.argv.slice(2);
for (const origin of [api, identity]) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin) {
    throw new Error('Both APK origins must be canonical HTTPS origins.');
  }
}
if (api === identity || ['compile.invalid', 'agusweb.up.railway.app'].includes(new URL(api).hostname)) {
  throw new Error('Use the configured Devnet Crypto API origin.');
}
NODE

checksum="$(sha256sum < "$apk")"
checksum="${checksum%% *}"
if [[ -n "$checksums" && "$(cat -- "$checksums")" != "$checksum  $(basename -- "$apk")" ]]; then
  printf '%s\n' 'APK SHA-256 does not match the release checksum.' >&2
  exit 1
fi

build_tools="${ANDROID_BUILD_TOOLS:-}"
if [[ -z "$build_tools" && -n "${ANDROID_HOME:-}" ]]; then
  build_tools="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
fi
aapt="${build_tools:+$build_tools/}aapt"
signer_jar="$build_tools/lib/apksigner.jar"
if [[ -z "$build_tools" || ! -f "$signer_jar" ]]; then
  printf '%s\n' 'Set ANDROID_BUILD_TOOLS to an Android SDK Build Tools directory.' >&2
  exit 1
fi

# Use the same verification library as apksigner without parsing human-readable
# certificate output, whose format differs between Android SDK releases.
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
java --class-path "$signer_jar" "$script_dir/VerifyApkSigner.java" "$apk" "$fingerprint"

badging="$("$aapt" dump badging "$apk")"
grep -E "^package: name='app\.agus\.prototype' " <<< "$badging"
grep -E "^native-code: 'arm64-v8a' *$" <<< "$badging"
manifest="$("$aapt" dump xmltree "$apk" AndroidManifest.xml)"
manifest_hosts="$(sed -nE 's/.*android:host\(0x[0-9a-fA-F]+\)="([^"]+)".*/\1/p' <<< "$manifest")"
grep -Fx "${identity_origin#https://}" <<< "$manifest_hosts"

node --input-type=module - "$apk" "$api_origin" "$identity_origin" <<'NODE'
import { execFileSync } from 'node:child_process';

const [apk, api, identity] = process.argv.slice(2);
const bundle = execFileSync('unzip', ['-p', apk, 'assets/index.android.bundle'], { maxBuffer: 32 * 1024 * 1024 });
const contains = (value) => bundle.includes(Buffer.from(value)) || bundle.includes(Buffer.from(value, 'utf16le'));
if (!contains(api) || !contains(identity) || contains('https://compile.invalid') || contains('https://agusweb.up.railway.app')) {
  throw new Error('The packaged Android bundle does not contain the expected API and wallet identity origins.');
}
NODE

curl --fail --silent --show-error --max-time 20 "$identity_origin/.well-known/assetlinks.json" |
  jq -e --arg fingerprint "$fingerprint" 'any(.[];
    .target.namespace == "android_app" and .target.package_name == "app.agus.prototype" and
    (.relation | index("delegate_permission/common.handle_all_urls")) and
    any(.target.sha256_cert_fingerprints[]; (gsub(":"; "") | ascii_upcase) == $fingerprint)
  )' >/dev/null
curl --fail --silent --show-error --max-time 20 "$api_origin/api/v1/ready" |
  jq -e '.status == "ready"' >/dev/null
curl --fail --silent --show-error --max-time 20 "$api_origin/api/v1/openapi" |
  jq -e '.paths["/api/v1/crypto/attempts/{id}/handoff"].post' >/dev/null

printf 'Signer SHA-256: %s\nAPK SHA-256: %s\nAPI origin: %s\nDigital Asset Links origin: %s\n' \
  "$fingerprint" "$checksum" "$api_origin" "$identity_origin"
