import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("benchmark-balanced.py")
REPORT = {
    "imagesRewritten": 2,
    "decodedPixels": 3_000_000,
    "budgetSkippedImages": 1,
    "stoppedEarly": True,
}


class BenchmarkTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = staticmethod(runpy.run_path(str(SCRIPT))["main"])

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(dir=os.environ.get("BENCHMARK_TEST_SCRATCH_DIR"))
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.source = self.directory / "private-source.pdf"
        self.source.write_bytes(b"a" * 1000)
        self.scratch = self.directory / "private-scratch"
        self.scratch.mkdir()
        self.candidate_size = 600
        self.candidate_pages = 2
        self.candidate_text = b"private fixture text\f"
        self.candidate_returncode = 0
        self.candidate_report = REPORT
        self.baseline_returncode = 0
        self.commands = []
        self.fail_candidate_text_proof = False

    def fake_subprocess(self, command, **options):
        self.assertEqual(options["timeout"], 42)
        self.assertFalse(options["check"])
        self.assertEqual(options["stderr"], subprocess.PIPE)
        self.assertEqual(options["env"]["LC_ALL"], "C")
        if command[0] == "pdfinfo":
            pages = self.candidate_pages if Path(command[-1]).name == "candidate.pdf" else 2
            data = f"Title: private title\nPages: {pages}\n".encode()
        elif command[0] == "pdftotext":
            self.assertEqual(command[1:-2], ["-layout", "-enc", "UTF-8", "-eol", "unix"])
            self.assertEqual(command[-1], "-")
            is_candidate = Path(command[-2]).name == "candidate.pdf"
            if is_candidate and self.fail_candidate_text_proof:
                return subprocess.CompletedProcess(
                    command, 0, stdout=b"private fixture text\f", stderr=b"private extraction warning"
                )
            data = self.candidate_text if is_candidate else b"private fixture text\f"
        else:
            self.commands.append(command)
            source, target = map(Path, command[2:4])
            self.assertEqual(source, self.source.resolve())
            self.assertEqual(target.parent.parent, self.scratch.resolve())
            prioritize = "--prioritize-savings" in command
            code = self.candidate_returncode if prioritize else self.baseline_returncode
            if code == "timeout":
                target.write_bytes(b"partial")
                raise subprocess.TimeoutExpired(command, 42, output=b"private tool output")
            if code:
                return subprocess.CompletedProcess(command, code, stdout=b"private tool output")
            target.write_bytes(b"b" * (self.candidate_size if prioritize else 700))
            data = json.dumps(self.candidate_report if prioritize else REPORT).encode()
        return subprocess.CompletedProcess(command, 0, stdout=data)

    def invoke(self, tool_lookup=lambda tool: tool):
        stdout = io.StringIO()
        with (
            patch("shutil.which", side_effect=tool_lookup),
            patch("subprocess.run", side_effect=self.fake_subprocess),
            contextlib.redirect_stdout(stdout),
        ):
            status = self.main([str(self.source), "--scratch-dir", str(self.scratch), "--timeout-seconds", "42"])
        raw_report = stdout.getvalue()
        self.assertNotIn("private", raw_report)
        self.assertEqual(self.source.read_bytes(), b"a" * 1000)
        self.assertEqual(list(self.scratch.iterdir()), [])
        return status, json.loads(raw_report)

    def test_shared_arguments_and_qualifying_candidate(self):
        status, report = self.invoke()
        self.assertEqual(status, 0)
        baseline, candidate = self.commands
        self.assertEqual(baseline[:3], candidate[:3])
        self.assertNotEqual(baseline[3], candidate[3])
        self.assertEqual(baseline[4:], [
            "--target-dpi", "150", "--quality", "72", "--mode", "preserve", "--allow-partial", "--report",
        ])
        self.assertEqual(candidate[4:], [*baseline[4:], "--prioritize-savings"])
        measured = report["inputs"][0]
        self.assertEqual(measured["decision"], "candidateImproved")
        self.assertEqual(measured["experimentalSavingsVsBaselinePercent"], 14.2857)
        self.assertEqual(measured["experimental"]["savingsPercent"], 40)
        self.assertEqual(measured["experimental"]["pages"], 2)
        self.assertTrue(measured["experimental"]["textUnchanged"])
        self.assertTrue(measured["experimental"]["pagesUnchanged"])
        for group in ("original", "baseline", "experimental"):
            self.assertNotIn("textSha256", measured[group])
        for key, value in REPORT.items():
            self.assertEqual(measured["baseline"][key], value)
        self.assertGreaterEqual(measured["experimental"]["wallSeconds"], 0)

    def test_candidate_between_baseline_and_original_is_rejected(self):
        self.candidate_size = 800
        status, report = self.invoke()
        self.assertEqual(status, 0)
        self.assertEqual(report["inputs"][0]["decision"], "candidateNotSmallerThanBaseline")

    def test_candidate_larger_than_original_is_rejected(self):
        self.candidate_size = 1100
        status, report = self.invoke()
        self.assertEqual(status, 0)
        self.assertEqual(report["inputs"][0]["decision"], "candidateNotSmallerThanOriginal")

    def test_changed_page_count_is_rejected_even_with_same_text(self):
        self.candidate_pages = 1
        status, report = self.invoke()
        self.assertEqual(status, 0)
        self.assertEqual(report["inputs"][0]["decision"], "candidateChangedPagesOrText")

    def test_changed_text_is_rejected_even_with_same_page_count(self):
        self.candidate_text = b"changed private fixture text\f"
        status, report = self.invoke()
        self.assertEqual(status, 0)
        self.assertEqual(report["inputs"][0]["decision"], "candidateChangedPagesOrText")

    def test_missing_text_tool_fails_before_processing_input(self):
        status, report = self.invoke(lambda tool: None if tool == "pdftotext" else tool)
        self.assertEqual(status, 1)
        self.assertEqual(report, {"error": "missingTools", "tools": ["pdftotext"]})
        self.assertEqual(self.commands, [])

    def test_invalid_report_cannot_qualify_candidate(self):
        self.candidate_report = {**REPORT, "decodedPixels": True}
        status, report = self.invoke()
        self.assertEqual(status, 1)
        self.assertEqual(report["inputs"][0]["decision"], "candidateUnproven")
        self.assertEqual(report["inputs"][0]["experimental"]["status"], "invalidResamplerReport")

    def test_timeout_cannot_qualify_candidate(self):
        self.candidate_returncode = "timeout"
        status, report = self.invoke()
        self.assertEqual(status, 1)
        self.assertEqual(report["inputs"][0]["decision"], "candidateUnproven")
        self.assertEqual(report["inputs"][0]["experimental"]["status"], "resamplerTimeout")

    def test_failed_text_extraction_cannot_qualify_candidate(self):
        self.fail_candidate_text_proof = True
        status, report = self.invoke()
        self.assertEqual(status, 1)
        self.assertEqual(report["inputs"][0]["decision"], "candidateUnproven")
        self.assertEqual(report["inputs"][0]["experimental"]["status"], "textProofUnavailable")

    def test_only_not_applicable_permits_comparison_against_original_alone(self):
        for code, expected_status, decision in (
            (2, 0, "candidateImproved"),
            (1, 1, "baselineUnproven"),
        ):
            with self.subTest(baseline_exit=code):
                self.baseline_returncode = code
                status, report = self.invoke()
                self.assertEqual(status, expected_status)
                self.assertEqual(report["inputs"][0]["decision"], decision)


if __name__ == "__main__":
    unittest.main()
