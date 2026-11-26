#!/bin/sh
set -eu
case "${1:-}" in
  api)
    node --import tsx scripts/crypto-devnet.ts api
    exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}"
    ;;
  worker)
    exec node --import tsx scripts/crypto-devnet.ts worker
    ;;
  *)
    printf '%s\n' 'Start mode must be api or worker.' >&2
    exit 2
    ;;
esac
