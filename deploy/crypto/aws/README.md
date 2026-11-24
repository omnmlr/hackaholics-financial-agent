# AGUS Crypto: Reproducible AWS Deployment Tooling & Runbook

This directory contains the production deployment tooling, container topology, host configuration scripts, and operational runbook for hosting the **AGUS Crypto Devnet** environment on Amazon Web Services (AWS) paired with Neon PostgreSQL.

---

## 1. Operational Architecture

The architecture consists of a single-host containerized stack deployed on an Amazon EC2 instance (`t3.small`) communicating with external services (Neon PostgreSQL and Solana Devnet RPCs):

```
                        Internet (Public HTTPS)
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │       Amazon EC2 Host        │
                    │   (t3.small, 2 GiB RAM,      │
                    │    20 GB gp3, Ubuntu 24.04)  │
                    │                              │
                    │   ┌──────────────────────┐   │
                    │   │  Caddy Reverse Proxy │   │
                    │   │  (Ports 80 & 443)    │   │
                    │   │  Automatic TLS       │   │
                    │   └──────────┬───────────┘   │
                    │              │               │
                    │  Docker Bridge Network       │
                    │  (agus-crypto-internal)      │
                    │              │               │
                    │       ┌──────┴──────┐        │
                    │       ▼             ▼        │
                    │   ┌────────┐   ┌─────────┐   │
                    │   │  API   │   │ Worker  │   │
                    │   │ (:3000)│   │ (Daemon)│   │
                    │   └────┬───┘   └────┬────┘   │
                    └────────┼────────────┼────────┘
                             │            │
                             ▼            ▼
                     Neon PostgreSQL  Solana Devnet RPCs
                   (agus_crypto_devnet) (Primary & Verifier)
```

### Key Topology Principles
1. **Perimeter Isolation**: Only Caddy binds to external host ports `80` and `443`. The Next.js API container exposes port `3000` only within the internal Docker bridge network (`agus-crypto-internal`). The worker container exposes zero network ports.
2. **Off-Host Database**: The database runs on Neon PostgreSQL (`agus_crypto_devnet_20261124`). The application connects using the restricted runtime role `agus_crypto_devnet_runtime` with the `agus_runtime` role grant. Superuser privileges and `MIGRATION_DATABASE_URL` are strictly forbidden inside the application container.
3. **Defense in Depth**:
   - Container processes run as non-root user `node` (`UID:GID 1000:1000`).
   - Logging is bounded via Docker's JSON file driver (`max-size: 20m`, `max-file: 5`).
   - Instance Metadata Service Version 2 (IMDSv2) is strictly enforced with hop limit 1.
   - Secrets reside on host at `/etc/agus/crypto.env` (mode `0600`, owned by `root:root`) and are injected into `api` and `worker` via Docker Compose `env_file`, while **only** `APP_DOMAIN` is interpolated into the `caddy` container environment (zero API/DB secrets enter the proxy container).

---

## 2. Host Sizing & Selection Rationale

### 2.1 Instance Sizing Analysis

| Instance Type | vCPU | RAM | On-Demand Rate (`us-east-1`) | Sizing Suitability & Assessment |
|---|---|---|---|---|
| **`t3.micro`** | 2 | 1.0 GiB | $0.0104 / hr ($7.59 / mo) | **INSUFFICIENT**: Next.js server runtime consumes ~350–600 MB RSS, while the Worker daemon with RPC polling consumes ~150–250 MB RSS. Combined with host OS, Docker daemon, and Caddy proxy (~400 MB), total memory demand exceeds 900 MB, triggering immediate Out-Of-Memory (OOM) kills. |
| **`t3.small`** | 2 | 2.0 GiB | $0.0208 / hr ($15.18 / mo) | **OPTIMAL CANDIDATE**: 2.0 GiB provides reliable operational headroom: ~1024 MB limit for API container, ~512 MB limit for Worker container, ~100 MB for Caddy proxy, and ~400 MB for host OS and page cache. |
| **`t3.medium`** | 2 | 4.0 GiB | $0.0416 / hr ($30.37 / mo) | **OVERPROVISIONED**: Unnecessary compute and memory for devnet workload. Only justified if on-host `next build` is executed without swap (which is avoided via pre-built images). |
| **`t4g.small`** | 2 | 2.0 GiB (ARM64) | $0.0168 / hr ($12.26 / mo) | **NOT RECOMMENDED AT THIS STAGE**: While slightly cheaper, our current base image (`node:24-bookworm-slim`) and dependencies (`@noble/hashes`, `@solana/web3.js`) are x86_64-tested. Sticking to x86_64 avoids multi-architecture emulation divergence. |

### 2.2 CPU Credit Mode: Standard Enforcement
The EC2 T3 instance family defaults to `unlimited` credit mode. In `unlimited` mode, CPU usage exceeding the baseline (20% per vCPU for `t3.small`) incurs a surcharge of **$0.05 per vCPU-hour** ($1.20 per vCPU-day).
To completely eliminate financial risk and surprise billing:
- Instances **MUST** be launched in **Standard mode**: `--credit-specification CpuCredits=standard`.
- Under Standard mode, bursting is capped by accumulated CPU credits, ensuring predictable fixed pricing with zero burst surcharges.

### 2.3 Off-Host Image Build & Release Pinning Rationale
Compiling Next.js (`next build`) is an intensive memory and CPU operation that spikes above 2 GiB of RAM. Building the container image directly on a 2 GiB `t3.small` instance risks freezing the kernel or failing with `JavaScript heap out of memory`.
- **Default Production Path (Prebuilt Commit-Pinned Image)**: `docker-compose.yml` intentionally omits a default `build:` block and pins both `api` and `worker` to `${AGUS_IMAGE_REPO:-agus-crypto-app}:${AGUS_RELEASE_SHA:?}`. Running `docker compose --env-file /etc/agus/crypto.env up -d` on EC2 will never trigger an accidental `next build`.
- **Optional Host-Build Override (With Swap)**: If an emergency build must be run on a `t3.small` host, first provision at least 2 GiB of swap (`sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`) and explicitly layer `docker-compose.build.yml`:
  `docker compose -f docker-compose.yml -f docker-compose.build.yml --env-file /etc/agus/crypto.env build`

---

## 3. Official AWS Rate Card & Cost Calculation

All pricing is based on official AWS published On-Demand rates in region `us-east-1` (US East, N. Virginia) as of November 2026. **Zero speculative credits or hypothetical balances are assumed.**

### 3.1 Rate Schedule (`us-east-1`)

1. **Compute (EC2 `t3.small` Standard mode)**:
   - Hourly rate: `$0.0208 / hour`
   - Daily rate (24 hrs): `$0.0208 * 24 = $0.4992 / day`
   - Monthly rate (730 hrs): `$0.0208 * 730 = $15.184 / month`
2. **Storage (EBS 20 GB gp3 root volume)**:
   - Monthly rate: `$0.08 / GB-month`
   - Monthly total: `20 * $0.08 = $1.600 / month`
   - Daily rate (averaged across 30.4167 days): `$1.60 / 30.4167 = $0.0526 / day`
3. **Networking (Public IPv4 Address Charge)**:
   - Hourly rate (effective Feb 1, 2024): `$0.005 / hour`
   - Daily rate (24 hrs): `$0.005 * 24 = $0.1200 / day`
   - Monthly rate (730 hrs): `$0.005 * 730 = $3.650 / month`
4. **Data Transfer Out (Egress)**:
   - First 100 GB / month free across all AWS regions.
   - Devnet JSON payloads for the 5-day hackathon will total < 5 GB: `$0.00`.
5. **Database (Neon PostgreSQL)**:
   - Hosted on Neon Free Tier (0.5 GiB storage, 0.25 vCPU compute hours): `$0.00`.

### 3.2 Exact Cost Summary

$$\text{Daily Total} = \$0.4992 (\text{EC2}) + \$0.0526 (\text{EBS}) + \$0.1200 (\text{IPv4}) = \mathbf{\$0.6718 \text{ / day}}$$

$$\text{5-Day Hackathon Window (Nov 24–29, 2026)} = 5 \times \$0.6718 = \mathbf{\$3.36}$$

$$\text{Monthly Total (730 Hours)} = \$15.184 (\text{EC2}) + \$1.600 (\text{EBS}) + \$3.650 (\text{IPv4}) = \mathbf{\$20.434 \text{ / month}}$$

*Note on AWS Free Tier:* If the founder's AWS account is within the 12-month Free Tier period (offering 750 hours of `t2.micro`/`t3.micro` and 30 GB gp2/gp3), compute and storage may be $0, but the public IPv4 charge ($0.005/hr = $3.65/mo) remains mandatory unless promotional credits exist. The above figures represent conservative, guaranteed on-demand ceilings.

---

## 4. Operational Runbook

### Step 0: Founder-Only Preparation (Pre-requisites)
1. **Billing Check**: Navigate to `https://console.aws.amazon.com/billing/home`. Verify active account standing and remaining credits if any.
2. **Neon Database Setup**:
   - In Neon console (`agus-isolated-staging-20261023`), create database `agus_crypto_devnet_20261124`.
   - Run migrations `0001` through `0027` as database owner.
   - Apply `scripts/sql/runtime-role.sql` to establish the restricted runtime user `agus_crypto_devnet_runtime` and `agus_runtime` role.
3. **Domain Verification**: Ensure a stable public domain name (e.g. `crypto-devnet.example.com`) is designated and points an A record to the allocated EC2 Public IPv4.

### Step 1: EC2 Host Provisioning
Launch 1x EC2 instance with the following parameters:
- **AMI**: Ubuntu 24.04 LTS (Noble) or Debian 12 (Bookworm) 64-bit (x86_64)
- **Instance Type**: `t3.small`
- **CPU Credit Specification**: Standard (`--credit-specification CpuCredits=standard`)
- **Storage**: 20 GB gp3 root volume
- **Metadata Options**:
  ```bash
  aws ec2 modify-instance-metadata-options \
    --instance-id <INSTANCE_ID> \
    --http-tokens required \
    --http-put-response-hop-limit 1
  ```
- **Security Group**: Inbound TCP ports `80` (HTTP) and `443` (HTTPS) from `0.0.0.0/0`. Inbound port `22` (SSH) restricted to founder IP or managed exclusively via AWS Systems Manager (SSM) Session Manager.

### Step 2: Host Bootstrapping & Pinned Image Delivery
Connect to the instance via SSM Session Manager or SSH:
```bash
git clone https://github.com/omnmlr/hackaholics-financial-agent.git /opt/agus
cd /opt/agus/deploy/crypto/aws
sudo bash setup-host.sh
```
This script installs Docker CE, Docker Compose, sets Docker log limits (`max-size: 20m`), and provisions `/etc/agus` with permissions `0700`.

Build the commit-pinned `linux/amd64` image **off-host** (on a developer workstation or CI runner) and transfer it to the EC2 host via authenticated access:
```bash
# On build workstation (at exact release commit):
export AGUS_RELEASE_SHA=$(git rev-parse --short=12 HEAD)
docker build --platform linux/amd64 -t "agus-crypto-app:${AGUS_RELEASE_SHA}" -f deploy/crypto/Dockerfile .
docker save "agus-crypto-app:${AGUS_RELEASE_SHA}" | gzip > "/tmp/agus-crypto-${AGUS_RELEASE_SHA}.tar.gz"
# Transfer via short-lived authenticated channel (scp / private ECR / presigned S3 via SSM), then on EC2:
gunzip -c "/tmp/agus-crypto-${AGUS_RELEASE_SHA}.tar.gz" | sudo docker load
```
*(If pulling from a private registry instead, set `AGUS_IMAGE_REPO` in `/etc/agus/crypto.env` and run `docker compose --env-file /etc/agus/crypto.env pull` after Step 3.)*

### Step 3: Secrets Injection
Populate `/etc/agus/crypto.env` on the host:
```bash
sudo cp env.production.example /etc/agus/crypto.env
sudo chmod 0600 /etc/agus/crypto.env
sudo chown root:root /etc/agus/crypto.env
sudo nano /etc/agus/crypto.env
```
Fill in `AGUS_RELEASE_SHA` (matching the loaded commit SHA), `APP_DOMAIN`, `APP_ORIGIN`, `BETTER_AUTH_URL`, the database password, and generated secrets (`openssl rand -base64 32`), ensuring zero `REPLACE_WITH_*` placeholders remain.

### Step 4: Host Preflight Verification
Execute the host verification script:
```bash
sudo bash preflight-check.sh
```
The script validates Docker, file permissions (0600), rejection of any `REPLACE_WITH_*` placeholders, valid JSON/32-byte encryption keys, monitoring and wallet route flags, `APP_DOMAIN`/`APP_ORIGIN` alignment, `AGUS_RELEASE_SHA`, absence of forbidden variables (`MIGRATION_DATABASE_URL`, `PAYSTACK_SECRET_KEY`, `LIVE_TRANSFERS_ENABLED`), and port availability. Proceed only if it exits with code 0 (`[PASS]`).

### Step 5: Launch Stack
Start the containerized services passing `--env-file /etc/agus/crypto.env` so Compose interpolates `APP_DOMAIN` into `caddy` (for public Let's Encrypt / ZeroSSL TLS) and `AGUS_RELEASE_SHA` into `api` and `worker`:
```bash
docker compose --env-file /etc/agus/crypto.env up -d
```
Monitor startup logs:
```bash
docker compose --env-file /etc/agus/crypto.env logs -f
```

### Step 6: Post-Deployment Readiness Verification
Verify that the stack is healthy and Caddy has successfully provisioned TLS certificates:
```bash
curl -i https://<YOUR_APP_DOMAIN>/api/v1/ready
```
Expected response:
```http
HTTP/2 200
content-type: application/json; charset=utf-8
x-correlation-id: ...

{"status":"ready"}
```

### Step 7: Teardown & Rollback
To cleanly tear down the deployment without affecting host packages or secrets:
```bash
sudo bash rollback.sh
```
To purge persistent Caddy certificates and volume state:
```bash
sudo bash rollback.sh --purge-volumes
```

---

## 5. Security & Fail-Closed Enforcement Summary

| Check Category | Failure Condition | Enforced In | Resulting Behavior |
|---|---|---|---|
| **Identity Secret** | `BETTER_AUTH_SECRET` missing or < 32 chars | `scripts/crypto-devnet.ts` & `src/server/auth.ts` | Process exits 1 (`IDENTITY_CONFIGURATION_REQUIRED`); `/api/v1/ready` returns 503 |
| **Encryption Keys** | `AGUS_ENCRYPTION_ACTIVE_KEY` missing or invalid length | `src/server/secrets.ts` | Process exits 1 (`ENCRYPTION_KEY_UNAVAILABLE`); `/api/v1/ready` returns 503 |
| **Cluster & RPC** | RPC genesis hash != Devnet genesis | `src/server/crypto/rpc.ts` | Process exits 1 (`CHAIN_IDENTITY_MISMATCH`); `/api/v1/ready` returns 503 |
| **RPC Hostnames** | Primary and verifier RPC hostnames match | `src/server/crypto/rpc.ts` | Process exits 1 (`INDEPENDENT_VERIFIER_REQUIRED`) |
| **Origin Canonical**| `APP_ORIGIN` is not HTTPS or != `BETTER_AUTH_URL` | `scripts/crypto-devnet.ts` | Process exits 1 (`CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED`) |
| **DB Migrations** | `0027_crypto_requests.sql` missing | `src/server/migrations.ts` | Process exits 1 (`SCHEMA_MIGRATION_REQUIRED`); `/api/v1/ready` returns 503 |
| **DB Role Safety** | User has `CREATE` on public, lacks `agus_runtime`, or is superuser | `scripts/crypto-devnet.ts` | Process exits 1 (`POSTGRES_RUNTIME_ROLE_REQUIRED`) |
| **Readiness Probe**| Any dependency unready during traffic check | `src/app/api/v1/[...path]/route.ts` | Returns HTTP 500/503; Caddy does not route live traffic |
