#!/usr/bin/env bash
# ==============================================================================
# setup-host.sh - AGUS Crypto EC2 Host Bootstrapping Script
# Target OS: Ubuntu 24.04 LTS / Debian 12 (x86_64)
# Target Instance: t3.small (2 vCPU, 2 GiB RAM, 20GB gp3)
# ==============================================================================
set -euo pipefail

echo "==> [1/6] Verifying EC2 IMDSv2 configuration..."
IMDS_TOKEN=$(curl -s -S -f -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || true)

if [ -n "${IMDS_TOKEN}" ]; then
  echo "    IMDSv2 token acquisition succeeded."
  INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: ${IMDS_TOKEN}" \
    http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || echo "unknown")
  echo "    Running on EC2 instance: ${INSTANCE_ID}"
else
  echo "    WARNING: IMDSv2 token acquisition failed. Ensure instance metadata options enforce IMDSv2:"
  echo "    aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required --http-put-response-hop-limit 1"
fi

echo "==> [2/6] Updating base packages and installing dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  iptables

echo "==> [3/6] Installing official Docker CE & Docker Compose..."
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y --no-install-recommends \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

echo "==> [4/6] Configuring Docker daemon log bounds..."
mkdir -p /etc/docker
cat <<'EOF' > /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  },
  "live-restore": true,
  "no-new-privileges": true
}
EOF
systemctl restart docker
systemctl enable docker

echo "==> [5/6] Provisioning isolated directory and secrets permissions..."
mkdir -p /etc/agus
chmod 0700 /etc/agus
chown root:root /etc/agus

if [ ! -f /etc/agus/crypto.env ]; then
  touch /etc/agus/crypto.env
  chmod 0600 /etc/agus/crypto.env
  chown root:root /etc/agus/crypto.env
  echo "    Created /etc/agus/crypto.env placeholder with mode 0600."
  echo "    Populate this file using env.production.example via AWS SSM Session Manager."
else
  chmod 0600 /etc/agus/crypto.env
  chown root:root /etc/agus/crypto.env
  echo "    Verified existing /etc/agus/crypto.env with mode 0600."
fi

echo "==> [6/6] Verifying Docker installation..."
docker --version
docker compose version

echo "=============================================================================="
echo "Host setup complete!"
echo "Next steps:"
echo "1. Populate /etc/agus/crypto.env with verified devnet runtime variables."
echo "2. Run './preflight-check.sh' to verify configuration and connectivity."
echo "3. Run 'docker compose up -d' to start services."
echo "=============================================================================="
