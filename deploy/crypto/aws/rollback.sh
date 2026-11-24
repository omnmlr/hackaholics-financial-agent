#!/usr/bin/env bash
# ==============================================================================
# rollback.sh - Clean Teardown & Rollback for AGUS Crypto AWS Deployment
# Safely stops containers, cleans networks and volumes, without touching host OS
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

PURGE_VOLUMES="${1:-false}"

echo "=============================================================================="
echo "AGUS Crypto Deployment Rollback / Teardown"
echo "=============================================================================="

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker CLI is not installed or not in PATH." >&2
  exit 1
fi

echo "==> [1/3] Stopping and removing containers and internal networks..."
if [ "${PURGE_VOLUMES}" = "--purge-volumes" ] || [ "${PURGE_VOLUMES}" = "-v" ]; then
  echo "    Purging persistent volumes (caddy_data, caddy_config)..."
  docker compose down --volumes --remove-orphans
else
  echo "    Preserving persistent Caddy certificate volumes. (Pass --purge-volumes to remove)."
  docker compose down --remove-orphans
fi

echo "==> [2/3] Checking for dangling crypto deployment containers..."
CONTAINERS=$(docker ps -a --filter "name=agus-crypto" -q || true)
if [ -n "${CONTAINERS}" ]; then
  echo "    Removing residual containers: ${CONTAINERS}"
  docker rm -f ${CONTAINERS} || true
else
  echo "    No residual agus-crypto containers found."
fi

echo "==> [3/3] Preserving host secrets..."
if [ -f /etc/agus/crypto.env ]; then
  echo "    NOTE: /etc/agus/crypto.env has been PRESERVED on host."
  echo "    If full host decommissioning is desired, manually run: rm -f /etc/agus/crypto.env"
fi

echo "=============================================================================="
echo "Rollback completed successfully. Containers and networks removed."
echo "=============================================================================="
