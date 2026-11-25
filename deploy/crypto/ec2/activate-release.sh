#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID != 0 || $# != 2 ]]; then
  printf 'Usage: sudo bash activate-release.sh <verified-bundle> <api-hostname>\n' >&2
  exit 2
fi

bundle=$(realpath -- "$1")
host=$2
if [[ ! $host =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
  printf 'A public API hostname is required.\n' >&2
  exit 2
fi

state=/opt/agus-crypto
install -d -m 0700 "$state/releases"
exec 9>"$state/deploy.lock"
flock -n 9

for env_file in /etc/agus-crypto/{shared,api}.env; do
  if [[ ! -f $env_file || -L $env_file || $(stat -c '%u:%a' "$env_file") != 0:600 ]]; then
    printf 'Missing or insecure runtime file: %s\n' "$env_file" >&2
    exit 1
  fi
  if grep -qE '^(MIGRATION_DATABASE_URL|PAYSTACK_SECRET_KEY|LIVE_[A-Z_]*|PAYSTACK_TRANSFERS_ENABLED)=' "$env_file"; then
    printf 'Migration and live payment settings are forbidden in the Devnet runtime files.\n' >&2
    exit 1
  fi
done

(
  cd "$bundle"
  sha256sum --check --strict --status SHA256SUMS.txt
)
revision=$(<"$bundle/revision.txt")
image=$(<"$bundle/image-id.txt")
[[ $revision =~ ^[0-9a-f]{40}$ && $image =~ ^sha256:[0-9a-f]{64}$ ]]

if ! docker image inspect "$image" >/dev/null 2>&1; then
  docker load --input "$bundle/image.tar.gz"
fi
[[ $(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "linux/amd64 $revision" ]]

release=$state/releases/$revision-${image:7:12}
install -d -m 0700 "$release"
install -m 0644 "$bundle/compose.yml" "$bundle/Caddyfile" "$bundle/favicon.png" "$release/"
printf 'AGUS_CRYPTO_IMAGE=%s\nAGUS_CRYPTO_HOST=%s\n' "$image" "$host" > "$release/release.env"

compose() {
  local directory=$1
  shift
  env -u AGUS_CRYPTO_IMAGE -u AGUS_CRYPTO_HOST docker compose \
    --project-directory "$directory" --env-file "$directory/release.env" \
    --file "$directory/compose.yml" "$@"
}

previous=$(readlink -f "$state/current" || true)
verify_https() {
  curl --silent --show-error --fail --max-time 5 --retry 10 --retry-delay 3 --retry-all-errors \
    --resolve "$host:443:127.0.0.1" "https://$host/api/v1/ready" | grep -Fq '"status":"ready"'
}

compose "$release" config --quiet
if ! compose "$release" up --detach --wait --wait-timeout 180 || ! verify_https; then
  printf 'Release did not pass readiness.\n' >&2
  if [[ -n $previous && $previous != "$release" && -d $previous ]]; then
    compose "$previous" up --detach --wait --wait-timeout 180
    printf 'Restored the previous release.\n' >&2
  fi
  exit 1
fi

ln -sfn "$release" "$state/current.next"
mv -Tf "$state/current.next" "$state/current"
printf 'Release %s passed local HTTPS, API readiness and worker health.\n' "$revision"
