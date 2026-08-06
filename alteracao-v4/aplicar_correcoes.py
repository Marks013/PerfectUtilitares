#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

PACKAGE_DIR = Path(__file__).resolve().parent
PAYLOAD_DIR = PACKAGE_DIR / "payload"

OLD_HASHES: dict[str, str | None] = {
    "web/.env.example": "9c932df98bb071444dcefdc7b1202e76374523c334d881c805eb2ddfabba7796",
    "web/docker-compose.yml": "4a5cd8bfed35a5ec4c7a62f55f2e03f448ac6d39d75d35888da7dc6515cce909",
    "web/package-lock.json": "2b88099079aebd75ada0b947229237ca4c2ab2b66ad7b9e0c293a9b5a6ac3aa4",
    "web/package.json": "75bb7c25346dc3a53f6a2942f02b008cc0f768f4675029d881ad442ed45dd7df",
    "web/prisma/migrations/20260805190000_unimed_price_history_continuity/migration.sql": None,
    "web/src/app/api/unimed/calculation/route.test.ts": "fbc261964aff22e2cf1c0a1959d795fd23e52c87b9121b17deacdc2d50ef54d5",
    "web/src/app/api/unimed/calculation/route.ts": "b9c52276af643768fb3e2933835804c5e084fae5d119fc0547c4337beca43102",
    "web/src/app/api/unimed/email/route.test.ts": "30911f464de68e9e671f9c67b4d880887f00e26dd36e4a59511d3190bf1a67f2",
    "web/src/app/api/unimed/email/route.ts": "581e412a050ba33e1a34224a12743b9c5de40c7b0d3e580d1dbe1b3dc9ebcc63",
    "web/src/lib/unimed/calculation.test.ts": "2c51cf54afb03a6be483e1d0746583e9cef94b1a3f784de45f33b4e61a27b3e8",
    "web/src/lib/unimed/calculation.ts": "8001dae295da77df177600163693917afeb0dae7526c67f338f440265dab8348",
    "web/src/lib/unimed/email.test.ts": "44426ef2c7b6c352bd25505e51bef09c85f08d29808588f26f18b1f904b6c1aa",
    "web/src/lib/unimed/email.ts": "3b5c18c61f703e14a67b4d51dfa410b295958fa5848377aa9cfa52119e609e9b",
    "web/src/lib/unimed/price-history.test.ts": "a36b388c18ebec22bc65c6c3dbd941a204f8eca72fd9878d6d224f985d4902ca",
    "web/src/lib/unimed/publisher.ts": "6162188e5a484bbc4144ae14cfb2eed9fd5de7c1d6ffdc7e1c21067c20a98ee8",
    "web/src/lib/unimed/reconcile.test.ts": "ed0ecd60ee3d8777b9a389079c23c3dc6ed139963f13ad92d2194d66f592df32",
    "web/src/lib/unimed/reconcile.ts": "f3eb4e2e5d9cf06d985806ec6229f3014ecc53808c2e76bb3e3d5b7c8f84f9c8",
    "web/src/lib/unimed/schema.ts": "b18ab9d205bdee769df1cf185de0809b961e2210741ae277ccdbdf39e29dbe34",
    "web/src/lib/unimed/types.ts": "973fcacda6d87d57285fd7899700209fa4f687e2fe4e338f8f5e3d6aec37f680",
    "web/src/types/nodemailer.d.ts": None,
}

DESCRIPTIONS: dict[str, str] = {
    "web/.env.example": "documentar SMTP Gmail por variáveis de ambiente",
    "web/docker-compose.yml": "injetar SMTP Gmail no serviço app",
    "web/package.json": "adicionar Nodemailer sem atualizar npm",
    "web/package-lock.json": "fixar Nodemailer 8.0.11 no lockfile",
    "web/prisma/migrations/20260805190000_unimed_price_history_continuity/migration.sql": "corrigir continuidade histórica das vigências",
    "web/src/app/api/unimed/calculation/route.ts": "resolver preços independentes da competência atual e seguinte",
    "web/src/app/api/unimed/calculation/route.test.ts": "testar reajuste entre competências no cálculo oficial",
    "web/src/app/api/unimed/email/route.ts": "expor erros SMTP seguros e explicativos",
    "web/src/app/api/unimed/email/route.test.ts": "testar erros SMTP do Gmail",
    "web/src/lib/unimed/calculation.ts": "calcular proporcional atual e mensalidade seguinte com tabelas distintas",
    "web/src/lib/unimed/calculation.test.ts": "testar 6 dias atuais mais 30 dias seguintes",
    "web/src/lib/unimed/email.ts": "substituir Resend por SMTP Gmail com senha de aplicativo",
    "web/src/lib/unimed/email.test.ts": "testar assinatura HTML do Departamento Pessoal",
    "web/src/lib/unimed/price-history.test.ts": "validar tabela antiga até 31/07/2026",
    "web/src/lib/unimed/publisher.ts": "carregar vínculos da competência anterior na publicação",
    "web/src/lib/unimed/reconcile.ts": "conciliar dependentes sem titular usando competência anterior",
    "web/src/lib/unimed/reconcile.test.ts": "testar conciliação por matrícula e histórico",
    "web/src/lib/unimed/schema.ts": "validar valores independentes da próxima competência",
    "web/src/lib/unimed/types.ts": "transportar competências, dias e valores históricos",
    "web/src/types/nodemailer.d.ts": "declarar tipos mínimos do transporte SMTP",
}


class PatchError(RuntimeError):
    pass


@dataclass
class Change:
    path: str
    description: str
    content: bytes


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def full_file_changes(root: Path) -> list[Change]:
    changes: list[Change] = []
    for relative, expected_old_hash in OLD_HASHES.items():
        source = PAYLOAD_DIR / relative
        if not source.is_file():
            raise PatchError(f"Pacote incompleto: payload ausente para {relative}.")
        target = root / relative
        wanted = source.read_bytes()
        wanted_hash = sha256(wanted)
        if target.exists():
            current = target.read_bytes()
            current_hash = sha256(current)
            if current_hash == wanted_hash:
                continue
            if expected_old_hash is None:
                raise PatchError(
                    f"{relative}: arquivo já existe com conteúdo diferente do pacote V4."
                )
            if current_hash != expected_old_hash:
                raise PatchError(
                    f"{relative}: versão inesperada (SHA-256 {current_hash[:12]}). "
                    "Atualize para o commit 4eedbe7 ou envie o arquivo atual para revisão."
                )
        elif expected_old_hash is not None:
            raise PatchError(f"{relative}: arquivo esperado não foi encontrado.")
        changes.append(Change(relative, DESCRIPTIONS[relative], wanted))
    return changes


def replace_once(text: str, old: str, new: str, description: str) -> tuple[str, bool]:
    if new in text:
        return text, False
    count = text.count(old)
    if count != 1:
        raise PatchError(
            f"esperado 1 trecho para '{description}', encontrado {count}."
        )
    return text.replace(old, new, 1), True


def regex_once(
    text: str,
    pattern: str,
    replacement: str,
    description: str,
    applied_marker: str,
    flags: int = re.DOTALL,
) -> tuple[str, bool]:
    if applied_marker in text:
        return text, False
    compiled = re.compile(pattern, flags)
    matches = list(compiled.finditer(text))
    if len(matches) != 1:
        raise PatchError(
            f"esperado 1 bloco para '{description}', encontrado {len(matches)}."
        )
    return compiled.sub(lambda _: replacement, text, count=1), True


def transform_beneficiary_search(text: str) -> tuple[str, list[str]]:
    descriptions: list[str] = []
    old = '''                    {beneficiary.dependents.length > 0 ? (\n                      <span className="mt-1 block truncate text-xs text-[color:var(--app-muted)]">\n                        Dependente(s):{" "}\n                        {beneficiary.dependents\n                          .map((dependent) => dependent.fullName)\n                          .join(", ")}\n                      </span>\n                    ) : null}'''
    new = '''                    {beneficiary.dependents.length > 0 ? (\n                      <ul className="mt-2 space-y-1 text-xs text-[color:var(--app-muted)]">\n                        {beneficiary.dependents.map((dependent) => (\n                          <li key={dependent.id} className="break-words">\n                            <span className="font-bold text-[color:var(--app-fg)]">\n                              Dependente:\n                            </span>{" "}\n                            {dependent.fullName}\n                          </li>\n                        ))}\n                      </ul>\n                    ) : null}'''
    text, changed = replace_once(
        text, old, new, "exibir todos os dependentes na pesquisa"
    )
    if changed:
        descriptions.append("exibir todos os dependentes sem truncamento visual")
    return text, descriptions


def transform_workspace(text: str) -> tuple[str, list[str]]:
    descriptions: list[str] = []
    old_helper = '''function formatMoneyResult(value: string) {\n  const parsed = Number(value);\n  return Number.isFinite(parsed) ? `R$ ${moneyFormatter.format(parsed)}` : "—";\n}\n'''
    new_helper = old_helper + '''\nfunction formatCompetencyResult(value: string | null) {\n  if (!value) return "—";\n  const [year, month] = value.split("-");\n  return year && month ? `${month}/${year}` : value;\n}\n'''
    text, changed = replace_once(
        text, old_helper, new_helper, "adicionar formatação de competência no resultado"
    )
    if changed:
        descriptions.append("formatar competências MM/AAAA na memória do cálculo")

    replacement = '''                  <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">\n                    <ResultMetric\n                      label="Estorno ao funcionário"\n                      value={formatMoneyResult(result.employeeFullRefund)}\n                      emphasis\n                    />\n                    <ResultMetric\n                      label="Estorno à empresa"\n                      value={formatMoneyResult(result.companyFullRefund)}\n                      emphasis\n                    />\n                  </dl>\n                  <div className="mt-4 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4">\n                    <p className="text-xs font-black tracking-wide text-[color:var(--app-muted)] uppercase">\n                      Memória do cálculo\n                    </p>\n                    <dl className="mt-3 space-y-2 text-sm">\n                      <div className="flex justify-between gap-3">\n                        <dt className="text-[color:var(--app-muted)]">\n                          Proporcional de {formatCompetencyResult(result.currentCompetency)} ({result.refundDays} dias)\n                        </dt>\n                        <dd className="font-black text-[color:var(--app-fg)]">\n                          {formatMoneyResult(result.currentCompetencyRefund)}\n                        </dd>\n                      </div>\n                      {result.cutoffApplied && result.nextCompetency ? (\n                        <div className="flex justify-between gap-3">\n                          <dt className="text-[color:var(--app-muted)]">\n                            Mensalidade de {formatCompetencyResult(result.nextCompetency)} ({result.nextCompetencyDays} dias)\n                          </dt>\n                          <dd className="font-black text-[color:var(--app-fg)]">\n                            {formatMoneyResult(result.nextCompetencyRefund)}\n                          </dd>\n                        </div>\n                      ) : null}\n                      <div className="flex justify-between gap-3 border-t border-[color:var(--app-border)] pt-2">\n                        <dt className="font-black text-[color:var(--app-fg)]">\n                          Total estornado em fatura ({result.totalRefundDays} dias)\n                        </dt>\n                        <dd className="font-black text-[color:var(--app-fg)]">\n                          {formatMoneyResult(result.invoiceRefund)}\n                        </dd>\n                      </div>\n                    </dl>\n                  </div>\n'''
    pattern = r'''                  <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">.*?</dl>\n                  <p className="mt-3 rounded-xl border border-\[color:var\(--app-border\)\] bg-\[color:var\(--app-surface\)\] p-3 text-xs leading-5 text-\[color:var\(--app-muted\)\]">.*?</p>\n'''
    text, changed = regex_once(
        text,
        pattern,
        replacement,
        "simplificar o painel de resultados",
        "Memória do cálculo",
    )
    if changed:
        descriptions.append("destacar apenas estorno ao funcionário e à empresa")

    old_days = '''                        {result.refundDays}\n                      </span>\n                      <span className="text-xs text-[color:var(--app-muted)]">\n                        dias de estorno'''
    new_days = '''                        {result.totalRefundDays}\n                      </span>\n                      <span className="text-xs text-[color:var(--app-muted)]">\n                        dias devolvidos em fatura'''
    text, changed = replace_once(
        text, old_days, new_days, "mostrar total de dias entre competências"
    )
    if changed:
        descriptions.append("mostrar 36 dias quando houver 6 atuais mais 30 seguintes")
    return text, descriptions


def transform_print_summary(text: str) -> tuple[str, list[str]]:
    descriptions: list[str] = []
    old_decl = '''  const daysInMonth = data.result.daysInMonth;\n  const usedDays = data.result.usedDays;\n  const afterCutoff = data.result.cutoffApplied;\n  const competencyLabel = competence(data.competency);\n  const calculationCompetency = data.exclusionDate.slice(0, 7);'''
    new_decl = '''  const daysInMonth = data.result.daysInMonth;\n  const usedDays = data.result.usedDays;\n  const afterCutoff = data.result.cutoffApplied;\n  const baseCompetencyLabel = competence(data.competency);\n  const calculationCompetency = data.result.currentCompetency;\n  const currentCompetencyLabel = competence(calculationCompetency);\n  const nextCompetencyLabel = data.result.nextCompetency\n    ? competence(data.result.nextCompetency)\n    : nextUnimedCompetency(calculationCompetency);'''
    text, changed = replace_once(
        text, old_decl, new_decl, "separar competência cadastral e competência calculada"
    )
    if changed:
        descriptions.append("usar referência MM/AAAA da competência calculada")

    text, changed = replace_once(
        text,
        "              <td>{competencyLabel}</td>",
        "              <td>{currentCompetencyLabel}</td>",
        "usar competência calculada na coluna Referência",
    )
    if changed:
        descriptions.append("corrigir referência do PDF")

    text, changed = replace_once(
        text,
        "            Competência da base: <strong>{competencyLabel}</strong>",
        "            Competência da base cadastral: <strong>{baseCompetencyLabel}</strong>",
        "renomear competência cadastral",
    )
    if changed:
        descriptions.append("distinguir base cadastral da tabela de cálculo")

    if "nextCompetencyLabel" in text:
        old_next = "nextUnimedCompetency(calculationCompetency)"
        # Preserve the fallback inside the declaration; replace only later occurrences.
        first = text.find(old_next)
        if first >= 0:
            tail = text[first + len(old_next):]
            tail = tail.replace(old_next, "nextCompetencyLabel")
            text = text[: first + len(old_next)] + tail

    totals_pattern = r'''        <dl className="unimed-print-totals">.*?        </dl>'''
    totals_new = '''        <dl className="unimed-print-totals">\n          <div className="refund-highlight">\n            <dt>Estorno ao funcionário</dt>\n            <dd>{money(data.result.employeeFullRefund)}</dd>\n          </div>\n          <div className="refund-highlight">\n            <dt>Estorno à empresa</dt>\n            <dd>{money(data.result.companyFullRefund)}</dd>\n          </div>\n          <div>\n            <dt>Proporcional de {currentCompetencyLabel} ({data.result.refundDays} dias)</dt>\n            <dd>{money(data.result.currentCompetencyRefund)}</dd>\n          </div>\n          {afterCutoff ? (\n            <div>\n              <dt>Mensalidade de {nextCompetencyLabel} ({data.result.nextCompetencyDays} dias)</dt>\n              <dd>{money(data.result.nextCompetencyRefund)}</dd>\n            </div>\n          ) : null}\n          <div className="calculation-total">\n            <dt>Total estornado em fatura ({data.result.totalRefundDays} dias)</dt>\n            <dd>{money(data.result.invoiceRefund)}</dd>\n          </div>\n        </dl>'''
    text, changed = regex_once(
        text,
        totals_pattern,
        totals_new,
        "simplificar totais do PDF",
        "className=\"refund-highlight\"",
    )
    if changed:
        descriptions.append("simplificar memória do PDF e destacar os dois estornos")

    footer_pattern = r'''      <footer className="unimed-print-footer">\n        <span>Mês com \{daysInMonth\} dias</span>\n        <span>\{usedDays\} dias utilizados</span>\n        <span>\{data\.result\.refundDays\} dias de estorno</span>\n        <span>\n          \{afterCutoff\n            \? "Inclui a competência seguinte já fechada"\n            : "Sem competência seguinte adicional"\}\n        </span>\n        <span>\n          Acessório Funeral identificado automaticamente por beneficiário\n        </span>\n      </footer>'''
    footer_new = '''      <footer className="unimed-print-footer">\n        <span>Mês com {daysInMonth} dias</span>\n        <span>{usedDays} dias utilizados</span>\n        <span>{data.result.totalRefundDays} dias devolvidos em fatura</span>\n        <span>\n          {data.result.refundDays} dias de {currentCompetencyLabel}\n          {afterCutoff\n            ? ` + ${data.result.nextCompetencyDays} dias de ${nextCompetencyLabel}`\n            : ""}\n        </span>\n        <span>\n          Acessório Funeral identificado automaticamente por beneficiário\n        </span>\n      </footer>'''
    text, changed = regex_once(
        text,
        footer_pattern,
        footer_new,
        "explicar total de dias no rodapé do PDF",
        "dias devolvidos em fatura",
    )
    if changed:
        descriptions.append("explicar 6 dias atuais mais 30 dias seguintes no PDF")

    old_css = '''          .unimed-print-totals dt { font-weight: 700; }\n          .unimed-print-totals dd { margin: 0; font-weight: 800; }\n          .unimed-print-totals .total-refund { color: #c00000; font-size: 8pt; border-bottom: 0; }'''
    new_css = '''          .unimed-print-totals dt { font-weight: 700; }\n          .unimed-print-totals dd { margin: 0; font-weight: 800; }\n          .unimed-print-totals .refund-highlight {\n            margin: 0 -1mm;\n            padding: 1.25mm 1mm;\n            border: .25mm solid #111827;\n            background: #f3f4f6 !important;\n            font-size: 7.5pt;\n            -webkit-print-color-adjust: exact;\n            print-color-adjust: exact;\n          }\n          .unimed-print-totals .calculation-total { border-bottom: 0; font-weight: 800; }'''
    text, changed = replace_once(
        text, old_css, new_css, "destacar estornos no CSS de impressão"
    )
    if changed:
        descriptions.append("aplicar destaque visual apenas aos valores principais")
    return text, descriptions


def transform_print_test(text: str) -> tuple[str, list[str]]:
    descriptions: list[str] = []
    old = '''      cutoffApplied: true,\n      currentCompetencyRefund: "0.00",\n      nextCompetencyRefund: "100.00",'''
    new = '''      cutoffApplied: true,\n      currentCompetency: "2026-08",\n      nextCompetency: "2026-09",\n      nextCompetencyDays: 30,\n      totalRefundDays: 30,\n      currentCompetencyRefund: "0.00",\n      nextCompetencyRefund: "100.00",\n      nextCompetencyInvoiceTotal: "100.00",\n      nextCompetencyPayrollCharge: "61.26",'''
    text, changed = replace_once(
        text, old, new, "atualizar campos de competência no teste do PDF"
    )
    if changed:
        descriptions.append("atualizar teste do PDF para competências independentes")

    old_display = '''        invoiceTotal: "100.00",\n        usedProrata: "100.00",'''
    new_display = '''        invoiceTotal: "100.00",\n        nextCompetencyInvoiceTotal: "100.00",\n        usedProrata: "100.00",'''
    text, changed = replace_once(
        text, old_display, new_display, "atualizar display do teste do PDF"
    )
    if changed:
        descriptions.append("testar valor mensal da próxima competência")

    if 'expect(content).toContain("Total estornado em fatura")' not in text:
        old_expect = 'expect(content).toContain("Total de valores estornados");'
        new_expect = 'expect(content).toContain("Total estornado em fatura");'
        text, changed = replace_once(
            text, old_expect, new_expect, "atualizar rótulo esperado no PDF"
        )
        if changed:
            descriptions.append("validar rótulo simplificado do PDF")
    return text, descriptions


def transform_seed(text: str) -> tuple[str, list[str]]:
    if "DATE '2024-07-01', DATE '2026-07-31'" in text:
        return text, []
    count = text.count("2025-07-31")
    if count == 0:
        raise PatchError(
            "seed histórico: não encontrei a vigência antiga terminando em 2025-07-31."
        )
    return text.replace("2025-07-31", "2026-07-31"), [
        f"estender tabela anterior até 31/07/2026 ({count} ocorrências)"
    ]


TARGETED_TRANSFORMS: list[tuple[str, Callable[[str], tuple[str, list[str]]]]] = [
    ("web/src/components/unimed/unimed-beneficiary-search.tsx", transform_beneficiary_search),
    ("web/src/components/unimed/unimed-calculation-workspace.tsx", transform_workspace),
    ("web/src/components/unimed/unimed-print-summary.tsx", transform_print_summary),
    ("web/src/components/unimed/unimed-print-summary.test.tsx", transform_print_test),
    ("web/scripts/unimed/seed-price-history-2024-2027.sql", transform_seed),
]


def targeted_changes(root: Path) -> list[Change]:
    changes: list[Change] = []
    for relative, transform in TARGETED_TRANSFORMS:
        target = root / relative
        if not target.is_file():
            raise PatchError(f"{relative}: arquivo não encontrado.")
        original = target.read_text(encoding="utf-8")
        try:
            updated, descriptions = transform(original)
        except PatchError as error:
            raise PatchError(f"{relative}: {error}") from error
        if updated != original:
            changes.append(
                Change(relative, "; ".join(descriptions), updated.encode("utf-8"))
            )
    return changes


def collect_changes(root: Path) -> list[Change]:
    if not (root / "web" / "package.json").is_file():
        raise PatchError(
            f"{root}: não parece ser a raiz do PerfectUtilitares (web/package.json ausente)."
        )
    changes = full_file_changes(root)
    full_paths = {change.path for change in changes}
    for change in targeted_changes(root):
        if change.path in full_paths:
            raise PatchError(f"alteração duplicada para {change.path}.")
        changes.append(change)
    return changes


def self_test() -> None:
    with tempfile.TemporaryDirectory(prefix="perfect-v4-selftest-") as temp:
        root = Path(temp)
        text = '''function formatMoneyResult(value: string) {\n  const parsed = Number(value);\n  return Number.isFinite(parsed) ? `R$ ${moneyFormatter.format(parsed)}` : "—";\n}\n'''
        updated, descriptions = transform_workspace_helper_only(text)
        assert "formatCompetencyResult" in updated
        assert descriptions
        second, second_descriptions = transform_workspace_helper_only(updated)
        assert second == updated
        assert not second_descriptions
        test_file = root / "atomic.txt"
        atomic_write(test_file, b"ok\n")
        assert test_file.read_bytes() == b"ok\n"


def transform_workspace_helper_only(text: str) -> tuple[str, list[str]]:
    old = '''function formatMoneyResult(value: string) {\n  const parsed = Number(value);\n  return Number.isFinite(parsed) ? `R$ ${moneyFormatter.format(parsed)}` : "—";\n}\n'''
    new = old + '''\nfunction formatCompetencyResult(value: string | null) {\n  if (!value) return "—";\n  const [year, month] = value.split("-");\n  return year && month ? `${month}/${year}` : value;\n}\n'''
    updated, changed = replace_once(text, old, new, "autoteste")
    return updated, (["ok"] if changed else [])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Aplica as correções V4 do módulo Unimed de forma idempotente."
    )
    parser.add_argument("root", nargs="?", default=".", help="raiz do repositório")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="somente valida e lista")
    mode.add_argument("--apply", action="store_true", help="aplica as alterações")
    mode.add_argument("--self-test", action="store_true", help="testa o aplicador")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        print("Autoteste do aplicador V4: OK")
        return 0

    root = Path(args.root).expanduser().resolve()
    try:
        changes = collect_changes(root)
        verb = "Aplicadas" if args.apply else "Validadas"
        if args.apply:
            for change in changes:
                atomic_write(root / change.path, change.content)
            # Verifica a reaplicação antes de considerar concluído.
            remaining = collect_changes(root)
            if remaining:
                raise PatchError(
                    f"aplicação incompleta: ainda restam {len(remaining)} alterações."
                )
        print(f"{verb} {len(changes)} alterações:")
        for change in changes:
            print(f"- {change.path}: {change.description}")
        if not changes:
            print("Todas as correções V4 já estão aplicadas.")
        elif not args.apply:
            print("Nenhum arquivo foi alterado. Execute novamente com --apply.")
        return 0
    except PatchError as error:
        print(f"ERRO: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
