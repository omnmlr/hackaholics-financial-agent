#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 2 || ! "$2" =~ ^([[:xdigit:]]{40}|[[:xdigit:]]{64})$ ]]; then
  printf '%s\n' 'Usage: bash scripts/android/prepare-release-signing.sh /durable/path/agus-signing.tar.gpg GPG_RECIPIENT_FINGERPRINT' >&2
  exit 2
fi

backup="$(realpath -m "$1")"
recipient="$2"
repo_root="$(git rev-parse --show-toplevel)"
case "$backup" in
  "$repo_root"/*|/workspace/*|/tmp/*|/var/tmp/*|/dev/*)
    printf '%s\n' 'Choose a durable backup directory outside the repository and temporary workspace.' >&2
    exit 2
    ;;
esac
[[ -d "$(dirname "$backup")" ]]
gpg --list-secret-keys "$recipient" >/dev/null

work="$(mktemp -d)"
candidate=""
trap 'rm -rf -- "$work"; if [[ -n "$candidate" ]]; then rm -f -- "$candidate"; fi' EXIT

restore_backup() {
  local source="$1" destination="$2"
  gpg --quiet --decrypt -- "$source" > "$work/restoring.tar"
  tar -xOf "$work/restoring.tar" -- agus-android.p12 > "$destination/agus-android.p12"
  tar -xOf "$work/restoring.tar" -- password > "$destination/password"
  [[ -s "$destination/agus-android.p12" && -s "$destination/password" ]]
  rm -f -- "$work/restoring.tar"
}

if [[ -f "$backup" ]]; then
  restore_backup "$backup" "$work"
else
  openssl rand -base64 48 > "$work/password"
  AGUS_SIGNING_PASSWORD="$(cat "$work/password")" keytool -genkeypair \
    -storetype PKCS12 -keystore "$work/agus-android.p12" \
    -storepass:env AGUS_SIGNING_PASSWORD -alias agus-android \
    -keyalg RSA -keysize 4096 -sigalg SHA256withRSA -validity 10950 \
    -dname 'CN=AGUS Android Release, O=AGUS' >/dev/null
  candidate="$(mktemp "$backup.XXXXXX")"
  tar -cf - -C "$work" agus-android.p12 password |
    gpg --quiet --batch --yes --encrypt --recipient "$recipient" --output "$candidate"
  mkdir "$work/restored"
  restore_backup "$candidate" "$work/restored"
  cmp "$work/agus-android.p12" "$work/restored/agus-android.p12"
  cmp "$work/password" "$work/restored/password"
  ln -- "$candidate" "$backup"
fi

fingerprint="$(AGUS_SIGNING_PASSWORD="$(cat "$work/password")" keytool -exportcert \
  -keystore "$work/agus-android.p12" -alias agus-android \
  -storepass:env AGUS_SIGNING_PASSWORD 2>/dev/null | openssl dgst -sha256 -r)"
fingerprint="${fingerprint%% *}"
[[ "$fingerprint" =~ ^[0-9a-f]{64}$ ]]
printf 'Verified encrypted backup: %s\nPublic certificate SHA-256: %s\n' "$backup" "${fingerprint^^}"

repo=omnmlr/hackaholics-financial-agent
base64 -w 0 "$work/agus-android.p12" | gh secret set AGUS_ANDROID_KEYSTORE_BASE64 --repo "$repo"
tr -d '\n' < "$work/password" | gh secret set AGUS_ANDROID_KEYSTORE_PASSWORD --repo "$repo"
printf '%s' agus-android | gh secret set AGUS_ANDROID_KEY_ALIAS --repo "$repo"
tr -d '\n' < "$work/password" | gh secret set AGUS_ANDROID_KEY_PASSWORD --repo "$repo"
gh variable set AGUS_ANDROID_CERT_SHA256 --body "${fingerprint^^}" --repo "$repo"
