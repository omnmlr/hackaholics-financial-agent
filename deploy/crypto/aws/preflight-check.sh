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
warn()  { yellow "  [WARN] $*"; }

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
IMDS_TOKEN=$(curl --connect-timeout 1 --max-time 2 -s -S -f -X PUT "http://169.254.169.254/latest/api/token" \
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
  # Helper to read variable without leaking value or corrupting inner JSON quotes
  get_val() {
    local raw
    raw=$(grep "^${1}=" "${ENV_FILE}" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '\r' || true)
    if [[ "${raw}" =~ ^\'(.*)\'$ ]]; then
      raw="${BASH_REMATCH[1]}"
    elif [[ "${raw}" =~ ^\"(.*)\"$ ]]; then
      raw="${BASH_REMATCH[1]}"
    fi
    printf '%s' "${raw}"
  }

  has_placeholder() {
    [[ "${1}" == *"REPLACE_WITH_"* ]]
  }

  # Global scan for unedited template placeholders (prints variable names only, never values)
  PLACEHOLDER_VARS=$(grep -E '^[^#[:space:]][^=]*=.*REPLACE_WITH_' "${ENV_FILE}" 2>/dev/null | cut -d'=' -f1 | tr '\n' ',' | sed 's/,$//' || true)
  if [ -n "${PLACEHOLDER_VARS}" ]; then
    fail "Unedited template placeholder(s) (REPLACE_WITH_*) detected in: ${PLACEHOLDER_VARS}"
  else
    pass "No unedited REPLACE_WITH_* template placeholders detected"
  fi

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

  # Required release pinning
  RELEASE_SHA=$(get_val "AGUS_RELEASE_SHA")
  if [ -z "${RELEASE_SHA}" ] || has_placeholder "${RELEASE_SHA}"; then
    fail "AGUS_RELEASE_SHA is missing or still contains a REPLACE_WITH_* placeholder"
  elif [[ "${RELEASE_SHA}" =~ ^[0-9a-fA-F]{7,40}$ ]] || [[ "${RELEASE_SHA}" =~ ^sha256:[0-9a-fA-F]{64}$ ]]; then
    pass "AGUS_RELEASE_SHA is pinned to release revision: ${RELEASE_SHA}"
  else
    fail "AGUS_RELEASE_SHA must be a 7-40 hex commit SHA or sha256 digest (got '${RELEASE_SHA}')"
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
  elif [ "${AUTH_PUB}" = "true" ]; then
    API_ENV_FILE="${API_ENV_FILE:-/etc/agus/crypto-api.env}"
    RESEND_KEY=$(get_val "RESEND_API_KEY")
    if [ -z "${RESEND_KEY}" ] && [ -r "${API_ENV_FILE}" ]; then
      RESEND_KEY=$(grep -E '^RESEND_API_KEY=' "${API_ENV_FILE}" 2>/dev/null | head -n1 | cut -d= -f2- || true)
    fi
    EMAIL_FROM=$(get_val "AGUS_AUTH_EMAIL_FROM")
    if [ -z "${EMAIL_FROM}" ] && [ -r "${API_ENV_FILE}" ]; then
      EMAIL_FROM=$(grep -E '^AGUS_AUTH_EMAIL_FROM=' "${API_ENV_FILE}" 2>/dev/null | head -n1 | cut -d= -f2- || true)
    fi
    if [ -n "${RESEND_KEY}" ] && [ -n "${EMAIL_FROM}" ]; then
      pass "AGUS_AUTH_PUBLIC is 'true' with verified Resend email settings configured"
    else
      fail "AGUS_AUTH_PUBLIC=true requires RESEND_API_KEY and AGUS_AUTH_EMAIL_FROM in ${API_ENV_FILE} (INVITE_ONLY_DEVNET_REQUIRED)"
    fi
  else
    fail "AGUS_AUTH_PUBLIC must be 'false' or 'true' with Resend (INVITE_ONLY_DEVNET_REQUIRED)"
  fi

  SOL_DEV=$(get_val "AGUS_SOLANA_DEVNET_ENABLED")
  if [ "${SOL_DEV}" = "true" ]; then
    pass "AGUS_SOLANA_DEVNET_ENABLED is set to 'true'"
  else
    fail "AGUS_SOLANA_DEVNET_ENABLED must be 'true'"
  fi

  CRYPTO_MON=$(get_val "AGUS_CRYPTO_MONITORING")
  if [ "${CRYPTO_MON}" = "true" ]; then
    pass "AGUS_CRYPTO_MONITORING is set to 'true'"
  else
    fail "AGUS_CRYPTO_MONITORING must be 'true' (DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED)"
  fi

  CRYPTO_ROUTES=$(get_val "AGUS_CRYPTO_DEVNET_ROUTES")
  HAS_PHANTOM=0
  HAS_SOLFLARE=0
  IFS=',' read -ra ROUTE_LIST <<< "${CRYPTO_ROUTES}"
  for route in "${ROUTE_LIST[@]}"; do
    trimmed=$(printf '%s' "${route}" | tr -d '[:space:]')
    [ "${trimmed}" = "phantom" ] && HAS_PHANTOM=1
    [ "${trimmed}" = "solflare" ] && HAS_SOLFLARE=1
  done
  if [ "${HAS_PHANTOM}" -eq 1 ] && [ "${HAS_SOLFLARE}" -eq 1 ]; then
    pass "AGUS_CRYPTO_DEVNET_ROUTES enables both phantom and solflare"
  else
    fail "AGUS_CRYPTO_DEVNET_ROUTES must include both phantom and solflare (DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED)"
  fi

  DB_URL=$(get_val "DATABASE_URL")
  if has_placeholder "${DB_URL}"; then
    fail "DATABASE_URL still contains a REPLACE_WITH_* placeholder (POSTGRES_RUNTIME_ROLE_REQUIRED)"
  elif [[ "${DB_URL}" =~ ^postgres(ql)?:// ]]; then
    pass "DATABASE_URL uses valid postgresql protocol without template placeholders"
  else
    fail "DATABASE_URL is missing or invalid protocol (POSTGRES_RUNTIME_ROLE_REQUIRED)"
  fi

  AUTH_SECRET=$(get_val "BETTER_AUTH_SECRET")
  if has_placeholder "${AUTH_SECRET}"; then
    fail "BETTER_AUTH_SECRET still contains a REPLACE_WITH_* placeholder (IDENTITY_CONFIGURATION_REQUIRED)"
  elif [ ${#AUTH_SECRET} -ge 32 ]; then
    pass "BETTER_AUTH_SECRET is configured with adequate entropy (${#AUTH_SECRET} chars >= 32)"
  else
    fail "BETTER_AUTH_SECRET is missing or shorter than 32 chars (IDENTITY_CONFIGURATION_REQUIRED)"
  fi

  ENC_KEY=$(get_val "AGUS_ENCRYPTION_ACTIVE_KEY")
  ENC_KEYS=$(get_val "AGUS_ENCRYPTION_KEYS")
  if [ -z "${ENC_KEY}" ] || [ -z "${ENC_KEYS}" ]; then
    fail "Encryption keys missing: ACTIVE_KEY or KEYS undefined (ENCRYPTION_KEY_UNAVAILABLE)"
  elif has_placeholder "${ENC_KEY}" || has_placeholder "${ENC_KEYS}"; then
    fail "Encryption keys still contain a REPLACE_WITH_* placeholder (ENCRYPTION_KEY_UNAVAILABLE)"
  else
    ENC_VALID=0
    if command -v node >/dev/null 2>&1; then
      if ENC_KEY="${ENC_KEY}" ENC_KEYS="${ENC_KEYS}" node -e '
        const keys = JSON.parse(process.env.ENC_KEYS || "{}");
        const val = keys[process.env.ENC_KEY || ""];
        if (typeof val !== "string") process.exit(1);
        const buf = Buffer.from(val, "base64");
        if (buf.length !== 32) process.exit(1);
      ' 2>/dev/null; then
        ENC_VALID=1
      fi
    elif command -v python3 >/dev/null 2>&1; then
      if ENC_KEY="${ENC_KEY}" ENC_KEYS="${ENC_KEYS}" python3 -c '
import base64, json, os, sys
keys = json.loads(os.environ.get("ENC_KEYS", "{}"))
val = keys.get(os.environ.get("ENC_KEY", ""))
if not isinstance(val, str):
    sys.exit(1)
raw = base64.b64decode(val, validate=True)
if len(raw) != 32:
    sys.exit(1)
' 2>/dev/null; then
        ENC_VALID=1
      fi
    else
      if [[ "${ENC_KEYS}" =~ ^\{.*\"${ENC_KEY}\"[[:space:]]*:[[:space:]]*\"[A-Za-z0-9+/=]{43,44}\" ]]; then
        ENC_VALID=1
      fi
    fi

    if [ "${ENC_VALID}" -eq 1 ]; then
      pass "AGUS_ENCRYPTION_ACTIVE_KEY (${ENC_KEY}) and AGUS_ENCRYPTION_KEYS verified (valid JSON, 32-byte key)"
    else
      fail "AGUS_ENCRYPTION_KEYS must be valid JSON mapping '${ENC_KEY}' to a 32-byte base64 key (ENCRYPTION_KEY_UNAVAILABLE)"
    fi
  fi

  APP_DOMAIN=$(get_val "APP_DOMAIN")
  APP_ORIGIN=$(get_val "APP_ORIGIN")
  AUTH_URL=$(get_val "BETTER_AUTH_URL")
  if [ -z "${APP_DOMAIN}" ] || has_placeholder "${APP_DOMAIN}" || [ "${APP_DOMAIN}" = "localhost" ]; then
    fail "APP_DOMAIN must be set to a real public hostname (got '${APP_DOMAIN}')"
  elif has_placeholder "${APP_ORIGIN}" || has_placeholder "${AUTH_URL}"; then
    fail "APP_ORIGIN / BETTER_AUTH_URL still contain a REPLACE_WITH_* placeholder"
  elif [[ "${APP_ORIGIN}" =~ ^https:// ]] && [[ ! "${APP_ORIGIN}" =~ /$ ]] && [ "${APP_ORIGIN}" = "${AUTH_URL}" ] && [ "${APP_ORIGIN}" = "https://${APP_DOMAIN}" ]; then
    pass "APP_DOMAIN (${APP_DOMAIN}) and canonical HTTPS APP_ORIGIN/BETTER_AUTH_URL match"
  else
    fail "APP_ORIGIN must be 'https://${APP_DOMAIN}' with no trailing slash and match BETTER_AUTH_URL (CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED)"
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
