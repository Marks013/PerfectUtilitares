"""Overlay this experiment into the exact official workspace and lock file.
No generated CLI, no dynamic dependency resolution, no local DB.
"""
import pathlib
import shutil
import subprocess
import sys
import os
import tomllib
import json
import copy

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

# RUSTSEC-2026-0190: only reviewed registry delta.
ANYHOW_OLD = '''name = "anyhow"
version = "1.0.102"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "7f202df86484c868dbad7eaa557ef785d5c66295e41b460ef922eca0723b842c"'''
ANYHOW_PATCHED = '''name = "anyhow"
version = "1.0.103"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "2a4385e2e34eb35d6b3efe798b9eb88096925d87726c0798709bf56d9ed84af3"'''

def verify_lock(original, candidate):
    if (original.count(ANYHOW_OLD) != 1 or candidate.count(ANYHOW_PATCHED) != 1
            or candidate.count(ENTRY) != 1
            or original != candidate.replace(ENTRY, "").replace(ANYHOW_PATCHED, ANYHOW_OLD)):
        raise ValueError("UPSTREAM_LOCK_MISMATCH")


def verify_toolchain(toolchain, manifest, env_pin=None):
    """The candidate has exactly one reviewed compiler; no floating stable."""
    selected = tomllib.loads(toolchain)["toolchain"]
    package = tomllib.loads(manifest)["package"]
    if (selected.get("channel") != "1.100.0"
            or package.get("rust-version") != selected["channel"]
            or package.get("edition") != "2021"
            or selected.get("targets") != ["aarch64-unknown-linux-musl"]
            or sorted(selected.get("components", [])) != ["clippy", "rustfmt"]
            or selected.get("profile") != "minimal"
            or env_pin is not None and env_pin != selected["channel"]):
        raise ValueError("TOOLCHAIN_PIN_MISMATCH")


# Cargo 1.100 detects these eight unused inherited aliases in the exact
# pinned v0.31.2 root. Crate manifests use explicit version/path entries.
# Remove aliases only from the disposable overlay, never from upstream Git.
UNUSED_ALIASES = (
    "solverforge-bridge", "solverforge-config", "solverforge-console",
    "solverforge-core", "solverforge-cvrp", "solverforge-macros",
    "solverforge-scoring", "solverforge-solver",
)

def overlay_manifest(original, members):
    before = tomllib.loads(original)
    declared = before["workspace"]["members"]
    if sorted(members) != sorted(declared) or MEMBER in declared:
        raise ValueError("UPSTREAM_MEMBER_DRIFT")
    def uses_alias(value, alias):
        if not isinstance(value, dict):
            return False
        return any((key == alias and isinstance(child, dict) and child.get("workspace") is True)
                   or uses_alias(child, alias) for key, child in value.items())
    parsed = [tomllib.loads(value) for value in members.values()]
    after = original
    expected = copy.deepcopy(before)
    for alias in UNUSED_ALIASES:
        line = f'{alias} = {{ path = "crates/{alias}" }}\n'
        if (after.count(line) != 1
                or before["workspace"]["dependencies"].get(alias) != {"path": f"crates/{alias}"}
                or any(uses_alias(doc, alias) for doc in parsed)):
            raise ValueError("UPSTREAM_ALIAS_DRIFT")
        after = after.replace(line, "")
        del expected["workspace"]["dependencies"][alias]
    anchor = '    "examples/nqueens",'
    if after.count(anchor) != 1:
        raise ValueError("UPSTREAM_MANIFEST_MISMATCH")
    after = after.replace(anchor, anchor + '\n    "' + MEMBER + '",')
    expected["workspace"]["members"].insert(declared.index("examples/nqueens") + 1, MEMBER)
    if tomllib.loads(after) != expected:
        raise ValueError("UPSTREAM_MANIFEST_DRIFT")
    return after


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
    selected_toolchain = (source / "rust-toolchain.toml").read_text()
    try:
        verify_toolchain(selected_toolchain, (source / "Cargo.toml").read_text(), os.getenv("RUST_VERSION"))
    except (ValueError, KeyError, TypeError):
        raise SystemExit("TOOLCHAIN_PIN_MISMATCH") from None
    try:
        verify_lock(lock.read_text(), wanted)
    except ValueError:
        raise SystemExit("UPSTREAM_LOCK_MISMATCH") from None
    original = manifest.read_text()
    try:
        members = tomllib.loads(original)["workspace"]["members"]
        documents = {member: (checkout / member / "Cargo.toml").read_text() for member in members}
        overlaid = overlay_manifest(original, documents)
        candidate = tomllib.loads((source / "Cargo.toml").read_text())
        if any(alias in candidate.get("dependencies", {}) for alias in UNUSED_ALIASES):
            raise ValueError("CANDIDATE_ALIAS_DRIFT")
    except (OSError, ValueError, KeyError, TypeError):
        raise SystemExit("UPSTREAM_MANIFEST_MISMATCH") from None
    print(json.dumps({"upstreamRevision": UPSTREAM, "removedUnusedWorkspaceAliases": list(UNUSED_ALIASES),
                      "memberManifestsChecked": len(documents), "lockUnchanged": True}))
    destination = checkout / MEMBER
    if destination.exists():
        raise SystemExit("OVERLAY_EXISTS")
    destination.mkdir()
    for file in ("Cargo.toml", "solver.toml"):
        shutil.copyfile(source / file, destination / file)
    shutil.copytree(source / "src", destination / "src")
    manifest.write_text(overlaid)
    lock.write_text(wanted)
    # Only the disposable verified checkout is overlaid. Prevent accidental
    # rustup fallback to the upstream historical 1.99.1 default.
    (checkout / "rust-toolchain.toml").write_text(selected_toolchain)

if __name__ == "__main__":
    main()
