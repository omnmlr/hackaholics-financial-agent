#!/usr/bin/env python3
"""Activate the already delivered AGUS Crypto Devnet release from an SSM TTY."""
import argparse
import base64
import binascii
import fcntl
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import tempfile
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import warnings

HOST = "13-48-206-202.sslip.io"
REVISION = "126a528c2b7b0accc380d2af7cddae58ed6e624a"
DATABASE = "agus_crypto_devnet_20261124"
ROLE = "agus_crypto_devnet_runtime"
JESSICA = "cgSgspJ2msm6clMCkdW9"
ROOT = Path("/etc/agus-crypto")
FILES = set("Caddyfile compose.yml activate-release.sh favicon.png revision.txt image-id.txt image.tar.gz".split())
DURABLE = ("BETTER_AUTH_SECRET", "AGUS_ENCRYPTION_ACTIVE_KEY", "AGUS_ENCRYPTION_KEYS")
PROVIDERS = ("AI_API_KEY", "FIRECRAWL_API_KEY", "ELEVENLABS_API_KEY")


class DeploymentError(Exception):
    pass


def run(args, message, capture=False, timeout=None, cwd=None):
    result = subprocess.run(args, stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.DEVNULL if capture else None,
                            text=True, check=False, timeout=timeout, cwd=cwd)
    if result.returncode:
        raise DeploymentError(message)
    return result.stdout if capture else None


def bundle_image(delivery_root):
    manifests = list(delivery_root.glob("SHA256SUMS.txt"))
    for levels in range(1, 5):
        manifests.extend(delivery_root.glob("*/" * levels + "SHA256SUMS.txt"))
    if len(manifests) != 1 or manifests[0].is_symlink():
        raise DeploymentError("Expected one extracted SHA256SUMS.txt below the release directory.")
    bundle = manifests[0].parent.resolve()
    listing = manifests[0].read_text(encoding="ascii").splitlines()
    entries = [re.fullmatch(r"[0-9a-f]{64} [ *](.+)", line) for line in listing]
    if (len(entries) != len(FILES) or any(match is None for match in entries)
            or {match[1] for match in entries} != FILES
            or any((bundle / name).is_symlink() or not (bundle / name).is_file() for name in FILES)):
        raise DeploymentError("The bundle manifest must list exactly the seven release files.")
    run(["sha256sum", "--check", "--strict", "--status", "SHA256SUMS.txt"],
        "The downloaded release files failed their checksums.", capture=True, cwd=bundle)
    revision = (bundle / "revision.txt").read_text().strip()
    image = (bundle / "image-id.txt").read_text().strip()
    if revision != REVISION or not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise DeploymentError("The bundle does not match the approved backend revision.")
    if subprocess.run(["docker", "image", "inspect", image], stdout=subprocess.DEVNULL,
                      stderr=subprocess.DEVNULL).returncode:
        print("Loading the verified image from its existing local archive.", flush=True)
        run(["docker", "load", "--input", str(bundle / "image.tar.gz")],
            "Docker could not load the existing verified archive.")
    facts = run(["docker", "image", "inspect", "--format",
                 '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}', image],
                "Docker could not inspect the release image.", capture=True)
    if facts.strip() != f"linux/amd64 {REVISION}":
        raise DeploymentError("Docker image platform or revision label mismatch.")
    print("Verified the approved Linux AMD64 image and all seven bundle files.", flush=True)
    return bundle, image


def read_config(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return {}
    with os.fdopen(fd, encoding="utf-8") as source:
        metadata = os.fstat(source.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > 65536):
            raise DeploymentError(f"Expected a regular root-owned 0600 file at {path}.")
        settings = {}
        for line in source.read().splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            name, sep, value = line.partition("=")
            if not sep or not re.fullmatch(r"[A-Z][A-Z0-9_]*", name) or name in settings:
                raise DeploymentError(f"Use unique, raw NAME=value lines in {path}.")
            settings[name] = value
    return settings


def ask_secret(name):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            value = getpass.getpass(f"{name} (hidden): ")
    except (getpass.GetPassWarning, EOFError):
        raise DeploymentError("Run in an interactive SSM terminal with echo control.") from None
    if not value or value != value.strip() or any(ord(char) < 32 for char in value):
        raise DeploymentError(f"{name} must be a nonempty single line.")
    return value


def write_config(path, settings):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=".agus-", delete=False) as sink:
        temporary = Path(sink.name)
        try:
            for name, value in settings.items():
                sink.write(f"{name}={value}\n")
            sink.flush()
            os.fsync(sink.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def verified_database_url(value):
    try:
        url = urlsplit(value)
        settings = dict(parse_qsl(url.query, strict_parsing=True))
        if (url.scheme not in ("postgresql", "postgres") or url.username != ROLE
                or not url.password or url.path != f"/{DATABASE}"
                or not (url.hostname or "").endswith(".neon.tech")
                or url.port not in (None, 5432) or url.fragment
                or set(settings) - {"sslmode", "channel_binding"}):
            raise ValueError()
    except ValueError:
        raise DeploymentError(f"Expected a Neon URL for {ROLE} on {DATABASE}.") from None
    settings["sslmode"] = "verify-full"
    return urlunsplit(url._replace(query=urlencode(settings)))


DB_CHECK = """
import { Pool } from "pg";
import { assertSchema } from "./src/server/migrations.ts";
const pool = new Pool({connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000, statement_timeout: 10000, max: 1});
try {
  await assertSchema(pool);
  const {rows:[row]} = await pool.query(`
    SELECT current_database() = 'agus_crypto_devnet_20261124'
      AND current_user = 'agus_crypto_devnet_runtime'
      AND pg_has_role(current_user, 'agus_runtime', 'USAGE')
      AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
      AND NOT has_table_privilege(current_user, 'agus_migrations', 'UPDATE,DELETE,INSERT,TRUNCATE')
      AND NOT has_column_privilege(current_user, 'agus_invitations', 'email', 'UPDATE')
      AND has_column_privilege(current_user, 'agus_invitations', 'consumed_at', 'UPDATE')
      AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user
                      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls))
      AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['agus_crypto_reviews','agus_crypto_receipts',
         'agus_crypto_chain_events','agus_crypto_wallet_events','agus_audit']) AS locked(name)
         WHERE has_table_privilege(current_user, locked.name, 'UPDATE,DELETE,TRUNCATE')
            OR has_any_column_privilege(current_user, locked.name, 'UPDATE')) AS safe,
      EXISTS (SELECT FROM agus_users) AS users,
      ARRAY(SELECT DISTINCT version FROM (
        SELECT state_envelope->>'keyVersion' AS version FROM agus_connections WHERE state_envelope IS NOT NULL
        UNION ALL SELECT credential_envelope->>'keyVersion' FROM agus_connections WHERE credential_envelope IS NOT NULL
        UNION ALL SELECT account_envelope->>'keyVersion' FROM agus_beneficiaries WHERE account_envelope IS NOT NULL
        UNION ALL SELECT envelope->>'keyVersion' FROM agus_inbox WHERE envelope IS NOT NULL
        UNION ALL SELECT details_envelope->>'keyVersion' FROM agus_usd_customers WHERE details_envelope IS NOT NULL
      ) AS envelopes) AS versions`);
  if (!row.safe) throw Error();
  process.stdout.write(JSON.stringify({users: row.users, versions: row.versions}));
} catch {
  process.exitCode = 1;
} finally {
  await pool.end();
}
"""


def db_check(image, url):
    with tempfile.TemporaryDirectory(prefix="db-check-", dir=ROOT) as directory:
        env = Path(directory) / "runtime.env"
        write_config(env, {"DATABASE_URL": url})
        result = run(["docker", "run", "--rm", "--read-only", "--cap-drop=ALL",
                      "--security-opt=no-new-privileges", "--env-file", str(env),
                      "--entrypoint", "node", image, "--import", "tsx",
                      "--input-type=module", "-e", DB_CHECK],
                     "Neon verification failed. Check the restricted URL, TLS, schema, and grants.",
                     capture=True, timeout=45)
    return json.loads(result)


def validate_keyring(api, required):
    try:
        keys = json.loads(api["AGUS_ENCRYPTION_KEYS"])
        if (not isinstance(keys, dict) or api["AGUS_ENCRYPTION_ACTIVE_KEY"] not in keys
                or not set(required).issubset(keys) or any(
                    not name or not isinstance(value, str)
                    or len(base64.b64decode(value, validate=True)) != 32
                    for name, value in keys.items())):
            raise ValueError()
    except (ValueError, TypeError, KeyError, binascii.Error):
        raise DeploymentError("The keyring must cover the active key and all stored envelope versions.") from None
    if len(api["BETTER_AUTH_SECRET"]) < 32:
        raise DeploymentError("BETTER_AUTH_SECRET must contain at least 32 characters.")


def configure(image, recovery):
    shared_path, api_path = ROOT / "shared.env", ROOT / "api.env"
    shared, api = read_config(shared_path), read_config(api_path)
    recovered = read_config(recovery) if recovery else {}
    for settings in (shared, api):
        if any(re.fullmatch(r"MIGRATION_DATABASE_URL|PAYSTACK_SECRET_KEY|LIVE_[A-Z_]*|PAYSTACK_TRANSFERS_ENABLED", name)
               for name in settings):
            raise DeploymentError("A runtime file contains a migration or live-payment setting.")
    for name in (*DURABLE, *PROVIDERS, "DATABASE_URL"):
        seen = {settings[name] for settings in (shared, api, recovered) if settings.get(name)}
        if name == "DATABASE_URL":
            seen = {verified_database_url(value) for value in seen}
        if len(seen) > 1:
            raise DeploymentError(f"Existing sources disagree on {name}. Resolve that privately before retrying.")
        if seen:
            target = shared if name == "DATABASE_URL" else api
            target[name] = seen.pop()
    for name in (*DURABLE, *PROVIDERS):
        shared.pop(name, None)
    api.pop("DATABASE_URL", None)

    if not shared.get("DATABASE_URL"):
        shared["DATABASE_URL"] = ask_secret("Restricted Neon DATABASE_URL")
    shared["DATABASE_URL"] = verified_database_url(shared["DATABASE_URL"])
    shared.setdefault("AGUS_DEVNET_RPC", "https://api.devnet.solana.com")
    shared.setdefault("AGUS_DEVNET_VERIFY_RPC", "https://devnet.rpcpool.com")
    evidence = db_check(image, shared["DATABASE_URL"])
    print("Neon TLS, checksummed schema and restricted runtime permissions verified.", flush=True)

    missing = [name for name in DURABLE if not api.get(name)]
    if missing:
        print("Missing on the host and in the supplied recovery file: " + ", ".join(missing), flush=True)
        fresh = (len(missing) == len(DURABLE) and not evidence["users"] and not evidence["versions"]
                 and input("If these secrets have never existed, type INITIALIZE to create them. Press Enter to enter recovered values: ") == "INITIALIZE")
        if fresh:
            api.update(BETTER_AUTH_SECRET=secrets.token_urlsafe(48), AGUS_ENCRYPTION_ACTIVE_KEY="devnet-v1",
                       AGUS_ENCRYPTION_KEYS=json.dumps({"devnet-v1": base64.b64encode(secrets.token_bytes(32)).decode()}))
        else:
            for name in missing:
                api[name] = ask_secret(name)
    validate_keyring(api, evidence["versions"])
    for name in PROVIDERS:
        if not api.get(name):
            api[name] = ask_secret(name)
    api.update(AI_PROVIDER="gemini", AGUS_CRYPTO_IMAGES="true", AGUS_CRYPTO_VOICE_ENABLED="true",
               ELEVENLABS_VOICE_ID=JESSICA)
    api.setdefault("ELEVENLABS_ZERO_RETENTION", "false")
    write_config(shared_path, shared)
    write_config(api_path, api)
    print("Protected shared and API runtime files installed. Keep a secured recovery copy.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=Path, default=Path("/home/ssm-user/agus-release"))
    parser.add_argument("--recover-from", type=Path, help="optional root-owned 0600 Crypto env backup")
    args = parser.parse_args()
    if os.geteuid() != 0 or not sys.stdin.isatty():
        raise DeploymentError("Run with sudo in the existing interactive SSM terminal.")
    args.release_dir = args.release_dir.resolve(strict=True)
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    metadata = ROOT.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise DeploymentError(f"Expected a root-owned configuration directory at {ROOT}.")
    bundle, image = bundle_image(args.release_dir)
    lock_fd = os.open(ROOT / ".stockholm-deploy.lock", os.O_CREAT | os.O_NOFOLLOW | os.O_WRONLY, 0o600)
    with os.fdopen(lock_fd, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise DeploymentError("Another interactive deployment is using the runtime files.") from None
        configure(image, args.recover_from)
        run(["bash", str(bundle / "activate-release.sh"), str(bundle), HOST],
            "Activation stopped. The protected runtime files remain available for retry.")
    ready = run(["curl", "--proto", "=https", "--fail", "--silent", "--max-time", "20",
                 f"https://{HOST}/api/v1/ready"],
                "Local HTTPS passed activation, but the public readiness request failed.", capture=True)
    if json.loads(ready).get("status") != "ready":
        raise DeploymentError("The public endpoint did not return ready.")
    contract = run(["curl", "--proto", "=https", "--fail", "--silent", "--max-time", "20",
                    f"https://{HOST}/api/v1/openapi"],
                   "Readiness passed, but the public Crypto OpenAPI request failed.", capture=True)
    paths = json.loads(contract).get("paths", {})
    if any(method not in paths.get(f"/api/v1/crypto/{route}", {}) for route, method in (
        ("portfolio", "get"), ("attempts/{id}/handoff", "post"),
        ("assistant/turns", "post"), ("assistant/transcriptions", "post"),
        ("assistant/conversations/{id}/turns/{turnId}/audio", "post"),
    )):
        raise DeploymentError("Readiness passed, but the public OpenAPI contract is incomplete.")
    print(f"Healthy Devnet API at https://{HOST}/api/v1/ready")


if __name__ == "__main__":
    try:
        main()
    except DeploymentError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        print("Deployment stopped while reading configuration or running a required check.", file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print("\nDeployment cancelled.", file=sys.stderr)
        sys.exit(130)
