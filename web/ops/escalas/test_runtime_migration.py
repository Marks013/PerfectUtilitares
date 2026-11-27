"""Runtime migration is proved without hiding unsupported model cases."""

import ast
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).parent


class RuntimeMigrationTests(unittest.TestCase):
    def test_importing_solver_does_not_load_ortools_or_scientific_stack(self):
        code = "import solver,sys; assert not any(n.split('.')[0] in {'ortools','numpy','pandas','google'} for n in sys.modules)"
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=5,
        )
        self.assertEqual(
            result.returncode, 0, "runtime still depends on retired optimizer"
        )

    def test_retired_engine_modules_are_absent(self):
        retired = [
            "optimization.py",
            "coverage_comparison.py",
            "coverage_service_protection.py",
            "sunday_peak.py",
            "weekend_balance.py",
            "hints.py",
            "leadership.py",
            "rest_quality.py",
            "diagnostics.py",
            "worker.py",
            "requirements.txt",
        ]
        self.assertEqual([name for name in retired if (ROOT / name).exists()], [])

    def test_runtime_import_graph_has_no_retired_algorithm(self):
        for name in [
            "solver.py",
            "native_runner.py",
            "server.py",
            "service_operations.py",
            "control.py",
        ]:
            modules = set()
            for node in ast.walk(ast.parse((ROOT / name).read_text())):
                if isinstance(node, ast.ImportFrom):
                    modules.add((node.module or "").split(".")[0])
                elif isinstance(node, ast.Import):
                    modules.update(n.name.split(".")[0] for n in node.names)
            self.assertFalse(
                modules
                & {
                    "ortools",
                    "numpy",
                    "pandas",
                    "optimization",
                    "hints",
                    "weekend_balance",
                    "worker",
                },
                name,
            )
