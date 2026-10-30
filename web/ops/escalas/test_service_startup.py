"""Start the actual entry point with a protected test-only secret file."""
import http.client
import json
import os
import pathlib
import secrets
import subprocess
import sys
import tempfile
import time
import unittest
from uuid import uuid4

from test_solver import fixture

ROOT = pathlib.Path(__file__).parent


class StartupTests(unittest.TestCase):
    def test_missing_or_public_secret_fails_closed_without_leaking_values(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "secret"
            secret = secrets.token_urlsafe(32)
            for mode in (None, 0o644, 0o600):
                if mode is not None:
                    target.write_text(secret if mode == 0o644 else "weak")
                    target.chmod(mode)
                environment = {**os.environ, "ESCALAS_SOLVER_SECRET_FILE": str(target)}
                result = subprocess.run([sys.executable, "-B", "server.py"], cwd=ROOT, env=environment,
                                        capture_output=True, text=True, timeout=3)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr.strip(), "SOLVER_CONFIG_INVALID")
                self.assertNotIn(secret, result.stdout + result.stderr)

    def test_entrypoint_reads_protected_file_and_processes_authenticated_model(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "secret"
            secret = secrets.token_urlsafe(32)
            target.write_text(secret + "\n")
            target.chmod(0o600)
            environment = {**os.environ, "ESCALAS_SOLVER_SECRET_FILE": str(target)}
            process = subprocess.Popen([sys.executable, "-B", "server.py"], cwd=ROOT, env=environment,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                until = time.monotonic() + 5
                while True:
                    if process.poll() is not None:
                        self.fail("Protected service exited before readiness")
                    try:
                        connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=0.2)
                        connection.request("GET", "/health")
                        response = connection.getresponse()
                        ready = response.status == 200 and json.loads(response.read()) == {"ok": True}
                        connection.close()
                        if ready:
                            break
                    except OSError:
                        if time.monotonic() > until:
                            self.fail("Protected service did not become ready")
                        time.sleep(0.02)
                connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=20)
                connection.request("POST", "/solve", json.dumps({"input": fixture()}), {
                    "Authorization": "Bearer " + secret,
                    "X-Request-ID": str(uuid4()), "X-Cancel-Token": secrets.token_hex(32),
                    "Content-Type": "application/json",
                })
                response = connection.getresponse()
                result = json.loads(response.read())
                connection.close()
                self.assertEqual(response.status, 200)
                self.assertIn(result["status"], {"FEASIBLE", "OPTIMAL"})
                self.assertEqual(len(result["assignments"]), 7)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
                stdout, stderr = process.communicate(timeout=1)
                self.assertNotIn(secret, stdout + stderr)
                self.assertEqual(stdout, "")
                self.assertEqual(stderr, "")


if __name__ == "__main__":
    unittest.main()
