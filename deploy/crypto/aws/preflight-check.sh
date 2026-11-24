#!/usr/bin/env bash
# ==============================================================================
# preflight-check.sh - Host-Side Verification Script for AGUS Crypto Deployment
# Runs fail-closed checks against host environment, Docker, secrets, and network
# ==============================================================================
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/agus/crypto.env}"
FAILURES=0

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

pass()  { green "  [PASS] $*"; }
fail()  { red   "  [FAIL] $*"; FAILURES=$((FAILURES + 1)); }
warn()  { yellow"  [WARN] $*"; }

echo "=============================================================================="
echo "AGUS Crypto AWS Host Preflight Verification"
echo "=============================================================================="

# ------------------------------------------------------------------------------
# 1. Docker Runtime Verification
# ------------------------------------------------------------------------------
echo "==> [1/6] Checking Docker runtime and Compose plugin..."
if command -v docker >/dev/null 2>&1; then
  pass "docker CLI is installed: $(docker --version)"
  if docker info >/dev/null 2>&1; then
    pass "Docker daemon is active and responsive"
  else
    fail "Docker daemon is not running or current user lacks access"
  fi
else
  fail "docker CLI is not installed"
fi

if docker compose version >/dev/null 2>&1; then
  pass "docker compose plugin is installed: $(docker compose version)"
else
  fail "docker compose plugin is not installed"
fi

# ------------------------------------------------------------------------------
# 2. Host Resources Check
# ------------------------------------------------------------------------------
echo "==> [2/6] Checking host memory and disk resources..."
TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
if [ "${TOTAL_MEM_KB}" -ge 1800000 ]; then
  pass "Total RAM is adequate: $((TOTAL_MEM_KB / 1024)) MB (>= 1.8 GiB required for t3.small)"
else
  warn "Total RAM is low: $((TOTAL_MEM_KB / 1024)) MB (< 1.8 GiB). t3.micro risk of OOM kills."
fi

FREE_DISK_KB=$(df -k / 2>/dev/null | tail -1 | awk '{print $4}' || echo "0")
if [ "${FREE_DISK_KB}" -ge 5000000 ]; then
  pass "Root filesystem has adequate free space: $((FREE_DISK_KB / 1024)) MB (>= 5 GB free)"
else
  warn "Root filesystem low on disk space: $((FREE_DISK_KB / 1024)) MB free"
fi

# ------------------------------------------------------------------------------
# 3. IMDSv2 Instance Metadata Check
# ------------------------------------------------------------------------------
echo "==> [3/6] Checking EC2 IMDSv2 configuration..."
IMDS_TOKEN=$(curl -s -S -f -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)
if [ -n "${IMDS_TOKEN}" ]; then
  pass "IMDSv2 token acquisition successful"
else
  warn "IMDSv2 check skipped (not running on EC2 or IMDS disabled)"
fi

# ------------------------------------------------------------------------------
# 4. Secrets & Configuration File Security
# ------------------------------------------------------------------------------
echo "==> [4/6] Checking secrets file existence and file permissions..."
if [ ! -f "${ENV_FILE}" ]; then
  fail "Environment file not found: ${ENV_FILE}"
else
  pass "Environment file exists: ${ENV_FILE}"

  # Check permissions (must not be group-writable or world-readable)
  PERMS=$(stat -c "%a" "${ENV_FILE}" 2>/dev/null || stat -f "%Lp" "${ENV_FILE}" 2>/dev/null || echo "unknown")
  if [ "${PERMS}" = "600" ] || [ "${PERMS}" = "400" ]; then
    pass "Environment file has strict permissions: ${PERMS}"
  else
    fail "Environment file has insecure permissions: ${PERMS} (must be 0600 or 0400)"
  fi
fi

# ------------------------------------------------------------------------------
# 5. Fail-Closed Variable Validation (offline static inspection of ENV_FILE)
# ------------------------------------------------------------------------------
echo "==> [5/6] Validating required and forbidden runtime environment variables..."
if [ -f "${ENV_FILE}" ]; then
  # Helper to read variable without leaking value
  get_val() {
    grep "^${1}=" "${ENV_FILE}" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"'\''\r' || true
  }

  # Forbidden variables (must NEVER be present in runtime container)
  MIG_DB=$(get_val "MIGRATION_DATABASE_URL")
  if [ -n "${MIG_DB}" ]; then
    fail "MIGRATION_DATABASE_URL is set in runtime config (POSTGRES_RUNTIME_ROLE_REQUIRED violation)"
  else
    pass "MIGRATION_DATABASE_URL is absent (runtime role isolation maintained)"
  fi

  PAYSTACK_KEY=$(get_val "PAYSTACK_SECRET_KEY")
  if [ -n "${PAYSTACK_KEY}" ]; then
    fail "PAYSTACK_SECRET_KEY is present in devnet config (forbidden credential contamination)"
  else
    pass "PAYSTACK_SECRET_KEY is absent"
  fi

  LIVE_TX=$(get_val "LIVE_TRANSFERS_ENABLED")
  if [ "${LIVE_TX}" = "true" ]; then
    fail "LIVE_TRANSFERS_ENABLED=true is forbidden in devnet deployment"
  else
    pass "LIVE_TRANSFERS_ENABLED is disabled"
  fi

  # Required variables
  ENV_PROFILE=$(get_val "AGUS_ENVIRONMENT")
  if [ "${ENV_PROFILE}" = "devnet" ]; then
    pass "AGUS_ENVIRONMENT is set to 'devnet'"
  else
    fail "AGUS_ENVIRONMENT must be 'devnet' (got '${ENV_PROFILE}')"
  fi

  AUTH_PUB=$(get_val "AGUS_AUTH_PUBLIC")
  if [ "${AUTH_PUB}" = "false" ]; then
    pass "AGUS_AUTH_PUBLIC is set to 'false' (invite-only devnet enforced)"
  else
    fail "AGUS_AUTH_PUBLIC must be 'false' (INVITE_ONLY_DEVNET_REQUIRED)"
  fi

  SOL_DEV=$(get_val "AGUS_SOLANA_DEVNET_ENABLED")
  if [ "${SOL_DEV}" = "true" ]; then
    pass "AGUS_SOLANA_DEVNET_ENABLED is set to 'true'"
  else
    fail "AGUS_SOLANA_DEVNET_ENABLED must be 'true'"
  fi

  DB_URL=$(get_val "DATABASE_URL")
  if [[ "${DB_URL}" =~ ^postgres(ql)?:// ]]; then
    pass "DATABASE_URL uses valid postgresql protocol"
  else
    fail "DATABASE_URL is missing or invalid protocol (POSTGRES_RUNTIME_ROLE_REQUIRED)"
  fi

  AUTH_SECRET=$(get_val "BETTER_AUTH_SECRET")
  if [ ${#AUTH_SECRET} -ge 32 ]; then
    pass "BETTER_AUTH_SECRET is configured with adequate entropy (${#AUTH_SECRET} chars >= 32)"
  else
    fail "BETTER_AUTH_SECRET is missing or shorter than 32 chars (IDENTITY_CONFIGURATION_REQUIRED)"
  fi

  ENC_KEY=$(get_val "AGUS_ENCRYPTION_ACTIVE_KEY")
  ENC_KEYS=$(get_val "AGUS_ENCRYPTION_KEYS")
  if [ -n "${ENC_KEY}" ] && [ -n "${ENC_KEYS}" ]; then
    pass "AGUS_ENCRYPTION_ACTIVE_KEY and AGUS_ENCRYPTION_KEYS are defined"
  else
    fail "Encryption keys missing: ACTIVE_KEY or KEYS undefined (ENCRYPTION_KEY_UNAVAILABLE)"
  fi

  APP_ORIGIN=$(get_val "APP_ORIGIN")
  AUTH_URL=$(get_val "BETTER_AUTH_URL")
  if [[ "${APP_ORIGIN}" =~ ^https:// ]] && [[ ! "${APP_ORIGIN}" =~ /$ ]] && [ "${APP_ORIGIN}" = "${AUTH_URL}" ]; then
    pass "APP_ORIGIN is canonical HTTPS and matches BETTER_AUTH_URL: ${APP_ORIGIN}"
  else
    fail "APP_ORIGIN must be HTTPS with no trailing slash and match BETTER_AUTH_URL (CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED)"
  fi

  RPC_DEV=$(get_val "AGUS_DEVNET_RPC")
  RPC_VERIFY=$(get_val "AGUS_DEVNET_VERIFY_RPC")
  if [[ "${RPC_DEV}" =~ ^https:// ]] && [[ "${RPC_VERIFY}" =~ ^https:// ]]; then
    HOST_DEV=$(echo "${RPC_DEV}" | awk -F[/:] '{print $4}')
    HOST_VERIFY=$(echo "${RPC_VERIFY}" | awk -F[/:] '{print $4}')
    if [ "${HOST_DEV}" != "${HOST_VERIFY}" ]; then
      pass "Solana RPCs use HTTPS with distinct hostnames (${HOST_DEV} vs ${HOST_VERIFY})"
    else
      fail "Primary and verifier RPC hostnames must be distinct (INDEPENDENT_VERIFIER_REQUIRED)"
    fi
  else
    fail "Solana RPC endpoints must use HTTPS"
  fi
fi

# ------------------------------------------------------------------------------
# 6. Network Port Availability Check
# ------------------------------------------------------------------------------
echo "==> [6/6] Checking host port availability for Caddy reverse proxy..."
check_port() {
  local port=$1
  if command -v ss >/dev/null 2>&1; then
    if ss -tuln | grep -q ":${port} "; then
      fail "Port ${port} is already in use on host"
    else
      pass "Port ${port} is available"
    fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -tuln | grep -q ":${port} "; then
      fail "Port ${port} is already in use on host"
    else
      pass "Port ${port} is available"
    fi
  else
    warn "ss/netstat not available; skipping port ${port} collision check"
  fi
}
check_port 80
check_port 443

# ------------------------------------------------------------------------------
# Summary & Exit Code
# ------------------------------------------------------------------------------
echo "=============================================================================="
if [ "${FAILURES}" -eq 0 ]; then
  green "PREFLIGHT CHECK PASSED: All host safety conditions satisfied."
  exit 0
else
  red "PREFLIGHT CHECK FAILED: ${FAILURES} check(s) failed. Fix issues before deployment."
  exit 1
fi
