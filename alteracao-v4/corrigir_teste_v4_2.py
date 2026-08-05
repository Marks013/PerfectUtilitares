#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


TARGET = Path("web/src/components/unimed/unimed-print-summary.test.tsx")

OLD = 'expect(markup).toContain("<td>07/2026</td><td>31/08/2026</td>");'
NEW = 'expect(markup).toContain("<td>08/2026</td><td>31/08/2026</td>");'


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Corrige a expectativa de referência do PDF na V4."
    )
    parser.add_argument("root", nargs="?", default=".", help="Raiz do repositório")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    target = root / TARGET

    if not target.is_file():
        raise SystemExit(f"ERRO: arquivo não encontrado: {target}")

    text = target.read_text(encoding="utf-8")
    old_count = text.count(OLD)
    new_count = text.count(NEW)

    if old_count == 0 and new_count == 1:
        print("Correção V4.2 já aplicada.")
        return 0

    if old_count != 1:
        raise SystemExit(
            "ERRO: esperado exatamente um trecho antigo no teste, "
            f"encontrado {old_count}. Nenhum arquivo foi alterado."
        )

    if new_count != 0:
        raise SystemExit(
            "ERRO: a expectativa nova já aparece em outro local. "
            "Nenhum arquivo foi alterado."
        )

    if args.check:
        print(f"Validada 1 alteração em {TARGET}:")
        print("- Referência esperada no PDF: 07/2026 -> 08/2026")
        print("Nenhum arquivo foi alterado. Execute novamente com --apply.")
        return 0

    target.write_text(text.replace(OLD, NEW, 1), encoding="utf-8")
    print(f"Aplicada 1 alteração em {TARGET}:")
    print("- Referência esperada no PDF: 07/2026 -> 08/2026")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
