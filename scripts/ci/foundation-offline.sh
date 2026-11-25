#!/usr/bin/env bash
set -euo pipefail
mode="${1:?foundation mode required}"
postgres_ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "${POSTGRES_CONTAINER:?Postgres service container required}")"
sudo iptables -I OUTPUT 1 ! -o lo -j REJECT
sudo iptables -I OUTPUT 1 -d "$postgres_ip" -p tcp --dport 5432 -j ACCEPT
sudo ip6tables -I OUTPUT 1 ! -o lo -j REJECT
trap 'sudo iptables -D OUTPUT -d "$postgres_ip" -p tcp --dport 5432 -j ACCEPT; sudo iptables -D OUTPUT ! -o lo -j REJECT; sudo ip6tables -D OUTPUT ! -o lo -j REJECT' EXIT

case "$mode" in
  core)
    python3 -B -m unittest discover -s deploy/crypto/ec2 -p 'test_*.py'
    AGUS_ENVIRONMENT=fixture npm run config:validate
    npm run typecheck
    npm run contracts:generate
    git diff --exit-code -- packages/contracts/openapi.json packages/api-client/src/generated.ts
    npm run mobile:typecheck
    npm run lint
    npm test
    ;;
  android-export)
    EXPO_PUBLIC_API_URL=https://prototype.fixture.invalid npm run mobile:export:android
    ;;
  web-build)
    npm run build
    ;;
  web-smoke)
    CHROMIUM_PATH="$(node --input-type=module -e 'import {chromium} from "playwright"; process.stdout.write(chromium.executablePath())')"
    export CHROMIUM_PATH
    npm run test:http
    npm run test:platform:http
    npm run test:agent-workspace
    npm run test:agent-followup
    npm run test:agent-runner
    npm run test:browser:workspace
    ;;
  *) exit 2 ;;
esac
