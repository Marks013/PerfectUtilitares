"""Run all real PDF Office regression tests in the isolated worker runtime."""
import importlib.util
from pathlib import Path
import sys
import unittest

suite = unittest.TestSuite()
for path in sorted(Path(__file__).parent.glob("office-export-*.test.py")):
    spec = importlib.util.spec_from_file_location(path.stem.replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
if not suite.countTestCases():
    raise RuntimeError("No PDF Office tests found")
sys.exit(0 if unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful() else 1)
