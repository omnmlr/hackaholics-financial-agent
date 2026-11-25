"""Regression tests for the Stockholm launcher's read-only database check."""
import importlib.util
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
