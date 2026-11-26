"""Overlay this experiment into the exact official workspace and lock file.
No generated CLI, no dynamic dependency resolution, no local DB.
"""
import pathlib
import shutil
import subprocess
import sys

UPSTREAM = "78889c3ff9fda158c70e6a1f67f8c7f0fdae922e"
MEMBER = "examples/perfectutilitares-solverforge-spike"
ENTRY = '''[[package]]
name = "perfectutilitares-solverforge-spike"
version = "0.1.0"
dependencies = [
 "serde_json",
 "solverforge",
]

'''

def main():
    source = pathlib.Path(__file__).resolve().parent
    checkout = pathlib.Path(sys.argv[1]).resolve()
    def git(*args):
        return subprocess.check_output(["git", "-C", str(checkout), *args], text=True).strip()
    if git("rev-parse", "HEAD") != UPSTREAM or git("status", "--porcelain"):
        raise SystemExit("UPSTREAM_IDENTITY_MISMATCH")
    manifest = checkout / "Cargo.toml"
    lock = checkout / "Cargo.lock"
    wanted = (source / "Cargo.lock").read_text()
    if wanted.count(ENTRY) != 1 or lock.read_text() != wanted.replace(ENTRY, ""):
        raise SystemExit("UPSTREAM_LOCK_MISMATCH")
    original = manifest.read_text()
    anchor = '    "examples/nqueens",'
    if original.count(anchor) != 1:
        raise SystemExit("UPSTREAM_MANIFEST_MISMATCH")
    destination = checkout / MEMBER
    if destination.exists():
        raise SystemExit("OVERLAY_EXISTS")
    destination.mkdir()
    for file in ("Cargo.toml", "solver.toml"):
        shutil.copyfile(source / file, destination / file)
    shutil.copytree(source / "src", destination / "src")
    manifest.write_text(original.replace(anchor, anchor + '\n    "' + MEMBER + '",'))
    lock.write_text(wanted)

if __name__ == "__main__":
    main()
