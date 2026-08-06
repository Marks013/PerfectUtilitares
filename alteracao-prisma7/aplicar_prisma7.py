#!/usr/bin/env python3
"""Aplicador idempotente da atualização Prisma 7 pós-V5."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(script_dir: Path) -> dict:
    with (script_dir / "manifest.json").open(encoding="utf-8") as stream:
        return json.load(stream)


def classify(target: Path, original: str | None, updated: str) -> tuple[str, str | None]:
    if not target.exists():
        return ("ready", None) if original is None else ("conflict", None)
    current = sha256(target)
    if current == updated:
        return "applied", current
    if original is not None and current == original:
        return "ready", current
    return "conflict", current


def atomic_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.prisma7-", dir=target.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        shutil.copyfile(source, tmp)
        shutil.copymode(source, tmp)
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Aplica ou verifica a atualização Prisma 7 pós-V5."
    )
    parser.add_argument("root", nargs="?", default=".", help="raiz do repositório")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="somente verificar compatibilidade")
    mode.add_argument("--apply", action="store_true", help="aplicar os arquivos")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not (root / ".git").is_dir() or not (root / "web").is_dir():
        print(f"ERRO: repositório PerfectUtilitares não encontrado em {root}", file=sys.stderr)
        return 2

    script_dir = Path(__file__).resolve().parent
    manifest = load_manifest(script_dir)
    states: list[tuple[dict, Path, str, str | None]] = []

    for item in manifest["files"]:
        target = root / item["path"]
        state, current = classify(target, item["original_sha256"], item["updated_sha256"])
        states.append((item, target, state, current))
        label = {"ready": "PRONTO", "applied": "APLICADO", "conflict": "CONFLITO"}[state]
        print(f"[{label:8}] {item['path']}")
        if state == "conflict":
            print(f"           hash atual: {current or 'arquivo ausente'}")

    conflicts = [entry for entry in states if entry[2] == "conflict"]
    if conflicts:
        print(
            "\nERRO: a base diverge da V5 usada para preparar a atualização Prisma 7.",
            file=sys.stderr,
        )
        print(
            "Nenhum arquivo foi alterado. Conclua a V5 ou revise a branch.",
            file=sys.stderr,
        )
        return 3

    if args.check:
        ready = sum(state == "ready" for _, _, state, _ in states)
        applied = sum(state == "applied" for _, _, state, _ in states)
        print(f"\nOK: {ready} arquivo(s) pronto(s), {applied} já aplicado(s).")
        return 0

    changed_count = 0
    for item, target, state, _ in states:
        if state == "applied":
            continue
        source = script_dir / item["payload"]
        if not source.is_file() or sha256(source) != item["updated_sha256"]:
            print(f"ERRO: payload inválido para {item['path']}", file=sys.stderr)
            return 4
        atomic_copy(source, target)
        changed_count += 1

    for item, target, _, _ in states:
        if not target.is_file() or sha256(target) != item["updated_sha256"]:
            print(f"ERRO: falha na verificação final de {item['path']}", file=sys.stderr)
            return 5

    print(f"\nAtualização Prisma 7 aplicada: {changed_count} arquivo(s) atualizado(s).")
    print("Próximo passo: bash alteracao-prisma7/atualizar_lock_prisma7.sh .")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
