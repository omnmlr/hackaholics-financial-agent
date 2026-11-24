# AWS deployment preflight — no provisioning yet

## Proposed target
Use the existing tested `deploy/crypto/Dockerfile` and API/worker entrypoints on one eligible EC2 host, with Neon providing PostgreSQL. Build once and run two separate containers from the same pinned image. Expose only the HTTPS reverse proxy; bind API to an internal Docker network and expose no worker or database listener. Verify restart recovery and readiness. No Kubernetes, RDS, NAT gateway or load balancer required for this short hackathon deployment.

AWS documentation lists `t3.small` and several other instance types as eligible for newer Free Tier accounts, subject to region/availability and account eligibility. A t3.small is an initial sizing candidate, NOT a measured recommendation; benchmark combined API/worker memory and CPU using an isolated local container run and use an eligible larger instance only if justified and covered. Prefer x86_64 to match existing build unless arm64 application image and dependencies are actually validated.

## Owner-only first check
1. Open https://console.aws.amazon.com/billing/home and AWS Settings; record plan (Free or Paid), remaining credits, expiry and current resource consumption. Do not share account IDs or secret values in agent prompts. The $100 initial credit email is historical, not a live balance.
2. In EC2 launch wizard, choose an available region and check free-tier-eligible instance types, Linux AMI and storage. Obtain actual pricing for compute, EBS, public IPv4, data transfer and any burst CPU surcharges. Record estimated daily/monthly total, projected remaining credit, and credit eligibility of each item. Configure T-family CPU credits in Standard mode if appropriate; validate against workload. Never assume a budget notification is a hard spending cap. Stop if an upgrade or out-of-pocket charge is required.
3. Confirm a stable hostname under founder control. An EC2 public DNS name alone does not establish a durable trusted HTTPS origin. Prepare DNS and TLS issuance/renewal; choose a permitted, costed solution before provisioning. Do not change live DNS or create paid services without approval.
4. Use an owner-authenticated AWS session/short-lived scoped access (prefer SSM Session Manager with attached least-privilege instance role where supported; do not grant an agent permanent admin/root keys). If SSM isn't available on the plan, use a narrowly restricted owner-managed SSH setup, never open SSH to the entire internet.
5. Founder explicitly approves exact deployment scope and credit budget before actual AWS mutations.

## Implementation preflight
- Add standalone tooling under `deploy/crypto/aws/`, including compose configuration and a repeatable setup/rollback procedure. Use the existing source/Dockerfile; ensure the built image references an exact commit/digest. Test compose syntax and run actual local disposable containers if Docker is available. Do not claim success if no runtime.
- Verify the new isolated database `agus_crypto_devnet_20261124` in existing Neon project. The owner connection is for migration only; runtime uses the restricted login and `agus_runtime` grants. See [deployment runbook](../DEVNET_DEPLOYMENT.md) and [Railway checkpoint](../RAILWAY_STAGED_REPURPOSE_20261124.md). Do not migrate the historical database or store migration credentials in application containers.
- Use a minimal explicit runtime variable allowlist. Preserve verified Devnet-only flags, invite-only auth and disabled live transfer flags. Require the intended DB name, HTTPS auth origin, encryption/auth secrets, approved RPC configuration and actual provider access. Keep secrets in approved secure host-side configuration, not Git, image layers, compose source, command history or logs. Do not copy legacy Railway payment credentials. Codex HTTP secrets are development access, not deployed environment variables.
- Ensure persistent API/worker restart policies, secure OS updates, nonroot app container, minimal ports (80/443 only for public HTTP/S as needed), protected instance metadata (IMDSv2), bounded log growth and external health checks. Worker must remain private. Build off-host if necessary to avoid exhausting server memory; private image distribution requires approved short-lived/authenticated access, not publishing a private repo or image.
- Validate TLS, `/api/v1/ready`, OpenAPI handoff, restricted DB role, invited auth, multi-wallet data, Gemini/ElevenLabs/Firecrawl capability when actually available, and worker monitoring/reconciliation. Test graceful 503/provider failure and restart recovery. Keep Mainnet execution and all real-money actions disabled.
- Provide exact owner commands and clear rollback/cleanup of only newly provisioned AWS resources. Do not alter or activate Railway staged changes.

## Primary references
- [EC2 Free Tier eligibility](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html)
- [Free account credit tracking](https://docs.aws.amazon.com/accounts/latest/reference/bcm-lite-free-tier-track.html)
- [Free and Paid plan rules](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
- [EC2 Session Manager](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/connect-with-systems-manager-session-manager.html)
- [SSM instance permissions](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-instance-profile.html)
- [EC2 on-demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/)
- [EBS pricing](https://aws.amazon.com/ebs/pricing/)
- [VPC public IPv4 pricing](https://aws.amazon.com/vpc/pricing/)

**Evidence boundary:** no AWS session, actual credit balance, cost estimate, eligible region, host, TLS hostname or live deployment has been verified here. This is a researched deployment preflight, not a successful deployment.
