"""Regression tests for the Stockholm launcher's read-only database check."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "deploy_stockholm", Path(__file__).with_name("deploy-stockholm.py")
)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class DatabaseCheckTests(unittest.TestCase):
    def test_enters_read_only_container_with_private_writable_tmpfs(self):
        fixture_url = (
            "postgresql://agus_crypto_devnet_runtime:fixture@"
            "ep-fixture.neon.tech/agus_crypto_devnet_20261124?sslmode=verify-full"
        )
        env_paths = []

        def run(arguments, _message, **options):
            self.assertEqual(arguments[:3], ["docker", "run", "--rm"])
            self.assertIn("--read-only", arguments)
            self.assertIn("--cap-drop=ALL", arguments)
            self.assertEqual(
                arguments[arguments.index("--tmpfs") + 1],
                "/tmp:size=64m,uid=1000,gid=1000,mode=1777",
            )
            self.assertIn("--import", arguments)
            self.assertIn("tsx", arguments)
            self.assertNotIn(fixture_url, arguments)
            env = Path(arguments[arguments.index("--env-file") + 1])
            env_paths.append(env)
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)
            self.assertEqual(env.read_text(), f"DATABASE_URL={fixture_url}\n")
            self.assertTrue(options["capture"])
            return '{"users":false,"versions":[]}'

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(launcher, "ROOT", Path(directory)), patch.object(
                launcher, "run", side_effect=run
            ):
                self.assertEqual(
                    launcher.db_check("fixture-image", fixture_url),
                    {"users": False, "versions": []},
                )
            self.assertFalse(env_paths[0].exists())

    def test_configure_enforces_google_pair_and_public_resend_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "shared.env").write_text(
                "DATABASE_URL=postgresql://agus_crypto_devnet_runtime:fixture@ep-fixture.neon.tech/agus_crypto_devnet_20261124?sslmode=verify-full\n",
                encoding="utf-8",
            )
            (root / "shared.env").chmod(0o600)
            valid_key = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
            (root / "api.env").write_text(
                "\n".join(
                    [
                        "BETTER_AUTH_SECRET=abcdefghijklmnopqrstuvwxyz123456",
                        "AGUS_ENCRYPTION_ACTIVE_KEY=v1",
                        f'AGUS_ENCRYPTION_KEYS={{"v1":"{valid_key}"}}',
                        "AI_API_KEY=ai-fixture",
                        "FIRECRAWL_API_KEY=fc-fixture",
                        "ELEVENLABS_API_KEY=el-fixture",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (root / "api.env").chmod(0o600)

            real_fstat = os.fstat

            def root_owned_fstat(fd):
                st = real_fstat(fd)
                return os.stat_result(
                    (
                        st.st_mode,
                        st.st_ino,
                        st.st_dev,
                        st.st_nlink,
                        0,
                        st.st_gid,
                        st.st_size,
                        st.st_atime,
                        st.st_mtime,
                        st.st_ctime,
                    )
                )

            with patch.object(launcher, "ROOT", root), patch.object(
                launcher, "db_check", return_value={"users": False, "versions": []}
            ), patch.object(launcher, "run"), patch("os.fstat", side_effect=root_owned_fstat):
                with self.assertRaises(launcher.DeploymentError):
                    launcher.configure("fixture-image", None, configure_identity=False, public_auth=True)

            (root / "api.env").write_text(
                (root / "api.env").read_text(encoding="utf-8")
                + "RESEND_API_KEY=re_fixture\nAGUS_AUTH_EMAIL_FROM=AGUS <noreply@mail.grindcity.app>\n"
                + "GOOGLE_CLIENT_ID=gid-fixture\nGOOGLE_CLIENT_SECRET=gsec-fixture\n",
                encoding="utf-8",
            )
            (root / "api.env").chmod(0o600)
            with patch.object(launcher, "ROOT", root), patch.object(
                launcher, "db_check", return_value={"users": False, "versions": []}
            ), patch("os.fstat", side_effect=root_owned_fstat):
                launcher.configure("fixture-image", None, configure_identity=False, public_auth=True)
            written = (root / "api.env").read_text(encoding="utf-8")
            self.assertIn("AGUS_AUTH_PUBLIC=true\n", written)
            self.assertIn("GOOGLE_CLIENT_ID=gid-fixture\n", written)
