"""Offline comparison of the two JPEG resampler orders. No PDF output is retained."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time


RESAMPLER = Path(__file__).resolve().parents[2] / "src/lib/pdf/jpeg-xobject-resample.py"
TARGET_DPI = 150
JPEG_QUALITY = 72
REPORT_COUNTS = ("imagesRewritten", "decodedPixels", "budgetSkippedImages")


class BenchmarkError(Exception):
    """A fixed diagnostic that is safe to report without subprocess output."""


class ArgumentParser(argparse.ArgumentParser):
    def error(self, _message):
        # argparse's normal errors may repeat an invalid argument (e.g. a path).
        print(json.dumps({"error": "invalidArguments"}))
        self.exit(2)


def run(command, timeout):
    return subprocess.run(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, "LC_ALL": "C"},
        timeout=timeout,
        check=False,
    )


def pdf_evidence(path, pdfinfo, pdftotext, timeout):
    info = run([pdfinfo, str(path)], timeout)
    pages = re.findall(rb"^Pages:[ \t]+([1-9][0-9]*)[ \t]*\r?$", info.stdout, re.MULTILINE)
    if info.returncode or info.stderr or len(pages) != 1:
        raise BenchmarkError("pageCountUnavailable")
    extracted = run([pdftotext, "-layout", "-enc", "UTF-8", "-eol", "unix", str(path), "-"], timeout)
    if extracted.returncode or extracted.stderr:
        raise BenchmarkError("textProofUnavailable")
    return {
        "bytes": path.stat().st_size,
        "pages": int(pages[0]),
        "textSha256": hashlib.sha256(extracted.stdout).hexdigest(),
    }


def parse_resample_report(raw):
    try:
        report = json.loads(raw)
        if not isinstance(report, dict):
            raise ValueError()
        counts = {key: report[key] for key in REPORT_COUNTS}
        if any(type(value) is not int or value < 0 for value in counts.values()):
            raise ValueError()
        if counts["imagesRewritten"] == 0 or type(report["stoppedEarly"]) is not bool:
            raise ValueError()
        return {**counts, "stoppedEarly": report["stoppedEarly"]}
    except (KeyError, ValueError) as error:
        raise BenchmarkError("invalidResamplerReport") from error


def savings_percent(before, after):
    return round((before - after) * 100 / before, 4)


def benchmark_order(source, original, output, proof_tools, timeout, *, prioritize=False):
    # Both runs use the same resampler and its unmodified internal pixel budget.
    command = [
        sys.executable, str(RESAMPLER), str(source), str(output),
        "--target-dpi", str(TARGET_DPI), "--quality", str(JPEG_QUALITY),
        "--mode", "preserve", "--allow-partial", "--report",
    ]
    if prioritize:
        command.append("--prioritize-savings")

    started = time.perf_counter()
    try:
        result = run(command, timeout)
    except subprocess.TimeoutExpired:
        return {"status": "resamplerTimeout", "wallSeconds": time.perf_counter() - started}
    except OSError:
        return {"status": "resamplerUnavailable", "wallSeconds": time.perf_counter() - started}
    metrics = {"wallSeconds": time.perf_counter() - started}
    if result.returncode == 2 and not output.exists():
        return {**metrics, "status": "notApplicable"}
    if result.returncode != 0:
        return {**metrics, "status": "resamplerFailed"}
    try:
        metrics.update(parse_resample_report(result.stdout))
        if not output.is_file() or output.stat().st_size == 0:
            raise BenchmarkError("outputUnavailable")
        evidence = pdf_evidence(output, *proof_tools, timeout)
    except BenchmarkError as error:
        return {**metrics, "status": str(error)}
    except subprocess.TimeoutExpired:
        return {**metrics, "status": "proofTimeout"}
    except OSError:
        return {**metrics, "status": "proofUnavailable"}

    text_unchanged = evidence.pop("textSha256") == original["textSha256"]
    return {
        **metrics,
        **evidence,
        "status": "measured",
        "savingsPercent": savings_percent(original["bytes"], evidence["bytes"]),
        "pagesUnchanged": evidence["pages"] == original["pages"],
        "textUnchanged": text_unchanged,
    }


def choose(original, baseline, candidate):
    if candidate["status"] == "notApplicable":
        return "candidateNotApplicable"
    if candidate["status"] != "measured":
        return "candidateUnproven"
    if not candidate["pagesUnchanged"] or not candidate["textUnchanged"]:
        return "candidateChangedPagesOrText"
    if candidate["bytes"] >= original["bytes"]:
        return "candidateNotSmallerThanOriginal"
    if baseline["status"] == "measured":
        if not baseline["pagesUnchanged"] or not baseline["textUnchanged"]:
            return "baselineChangedPagesOrText"
        if candidate["bytes"] >= baseline["bytes"]:
            return "candidateNotSmallerThanBaseline"
    elif baseline["status"] != "notApplicable":
        return "baselineUnproven"
    return "candidateImproved"


def compare(source, scratch, proof_tools, timeout):
    try:
        source = source.resolve(strict=True)
        if not source.is_file() or source.stat().st_size == 0:
            raise BenchmarkError("inputNotRegularOrEmpty")
        original = pdf_evidence(source, *proof_tools, timeout)
        with tempfile.TemporaryDirectory(prefix="balanced-", dir=scratch) as temporary:
            work = Path(temporary)
            baseline = benchmark_order(source, original, work / "baseline.pdf", proof_tools, timeout)
            candidate = benchmark_order(
                source, original, work / "candidate.pdf", proof_tools, timeout, prioritize=True
            )
    except BenchmarkError as error:
        return {"error": str(error)}
    except subprocess.TimeoutExpired:
        return {"error": "inputProofTimeout"}
    except (OSError, ValueError, RuntimeError):
        return {"error": "inputOrScratchUnavailable"}

    decision = choose(original, baseline, candidate)
    original.pop("textSha256")
    report = {"original": original, "baseline": baseline, "experimental": candidate, "decision": decision}
    if baseline["status"] == candidate["status"] == "measured":
        report["experimentalSavingsVsBaselinePercent"] = savings_percent(baseline["bytes"], candidate["bytes"])
    return report


def main(argv=None):
    parser = ArgumentParser(
        prog="benchmark-balanced.py",
        description="Compare JPEG orders on local PDFs and discard both outputs. "
        "Requires pdfimages, pdfinfo and pdftotext. JSON includes no paths or extracted text.",
    )
    parser.add_argument("inputs", nargs="+", type=Path, metavar="PDF")
    parser.add_argument("--scratch-dir", required=True, type=Path, help="Existing, private scratch directory.")
    parser.add_argument("--timeout-seconds", type=float, default=30, help="Timeout per subprocess (default: 30).")
    args = parser.parse_args(argv)
    if not math.isfinite(args.timeout_seconds) or args.timeout_seconds <= 0:
        parser.error("Invalid timeout.")
    binaries = {tool: shutil.which(tool) for tool in ("pdfinfo", "pdftotext", "pdfimages")}
    missing = [tool for tool, path in binaries.items() if path is None]
    if missing:
        print(json.dumps({"error": "missingTools", "tools": missing}))
        return 1
    proof_tools = (binaries["pdfinfo"], binaries["pdftotext"])
    reports = [
        compare(source, args.scratch_dir, proof_tools, args.timeout_seconds)
        for source in args.inputs
    ]
    print(json.dumps({"targetDpi": TARGET_DPI, "jpegQuality": JPEG_QUALITY, "inputs": reports}))
    return int(any(
        "error" in report
        or any(report[arm]["status"] not in ("measured", "notApplicable") for arm in ("baseline", "experimental"))
        for report in reports
    ))


if __name__ == "__main__":
    sys.exit(main())
