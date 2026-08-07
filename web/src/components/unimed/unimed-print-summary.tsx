"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  formatUnimedBranchForPdf,
  formatUnimedCompetency,
  nextUnimedCompetency,
} from "@/lib/unimed/print-format";
import type { UnimedCalculationResult } from "@/lib/unimed/types";

type PrintPerson = {
  id: string;
  registration: string | null;
  name: string;
  birthDate: string | null;
  age: number | null;
  planCode: string | null;
  hasFuneral: boolean;
  invoicePlanAmount: string;
  payrollPlanAmount: string | null;
  funeralAmount: string;
};

type UnimedPayrollLoanContract = {
  contractNumber: string;
  installmentAmount: string;
  startCompetence: string;
  endCompetence: string;
  bankCode: string;
  bankName: string;
};

export type UnimedPayrollLoanSummary = {
  competence: string;
  totalAmount: string;
  contracts: UnimedPayrollLoanContract[];
};

export type UnimedPrintSummaryData = {
  employeeName: string;
  cpf: string;
  registration?: string | null;
  reason: string;
  competency: string;
  exclusionDate: string;
  planEnrollmentDate: string;
  billingClosure: "OPEN" | "AUTOMATIC_DAY_25";
  branchCode: string | null;
  holder: PrintPerson;
  dependents: PrintPerson[];
  includePayrollLoans: boolean;
  payrollLoans: UnimedPayrollLoanSummary | null;
  result: UnimedCalculationResult;
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function numericMoney(value: string | null | undefined) {
  const normalized = String(value ?? "").replace(/[^\d,.-]/g, "");
  const decimal = normalized.includes(",")
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized;
  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string | null | undefined) {
  return moneyFormatter.format(numericMoney(value));
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function competence(value: string) {
  return formatUnimedCompetency(value);
}

function documentName(kind: UnimedCalculationResult["documentKind"]) {
  if (kind === "RN561") return "RN561";
  if (kind === "INACTIVE_TERM") return "Termo de inativo";
  return "Não aplicável";
}

export function UnimedPrintCopy({
  copy,
  data,
}: {
  copy: number;
  data: UnimedPrintSummaryData;
}) {
  const daysInMonth = data.result.daysInMonth;
  const usedDays = data.result.usedDays;
  const afterCutoff = data.result.cutoffApplied;
  const baseCompetencyLabel = competence(data.competency);
  const calculationCompetency = data.result.currentCompetency;
  const currentCompetencyLabel = competence(calculationCompetency);
  const nextCompetencyLabel = data.result.nextCompetency
    ? competence(data.result.nextCompetency)
    : nextUnimedCompetency(calculationCompetency);
  const rows = [data.holder, ...data.dependents];
  const loanCount = data.payrollLoans?.contracts.length ?? 0;
  const loanDensity =
    loanCount > 8 ? " is-dense" : loanCount > 4 ? " is-compact" : "";

  return (
    <section
      className="unimed-print-copy"
      aria-label={`Via ${copy} do cálculo`}
    >
      <header className="unimed-print-title">
        <strong>CÁLCULO UNIMED</strong>
        <span>Via {copy} de 2</span>
      </header>

      <table className="unimed-print-table">
        <colgroup>
          <col className="col-registration" />
          <col className="col-branch" />
          <col className="col-name" />
          <col className="col-reason" />
          <col className="col-date" />
          <col className="col-plan" />
          <col className="col-date" />
          <col className="col-date" />
          <col className="col-age" />
          <col className="col-money" />
          <col className="col-money" />
          <col className="col-money" />
          <col className="col-days" />
        </colgroup>
        <thead>
          <tr>
            <th>Cadastro</th>
            <th>Filial</th>
            <th>Nome</th>
            <th>Motivo</th>
            <th>Data Nasc.</th>
            <th>Plano</th>
            <th>Referência</th>
            <th>Exclusão</th>
            <th>Idade</th>
            <th>Valor Tabela</th>
            <th>Valor Titular</th>
            <th>Funeral</th>
            <th>Dias utilizados</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((person, index) => (
            <tr key={person.id}>
              <td>{index === 0 ? person.registration || "—" : "Dep"}</td>
              <td>{formatUnimedBranchForPdf(data.branchCode)}</td>
              <td className="name-cell">{person.name || "—"}</td>
              <td>{index === 0 ? data.reason : "—"}</td>
              <td>{date(person.birthDate)}</td>
              <td>{person.hasFuneral ? "02" : "01"}</td>
              <td>{currentCompetencyLabel}</td>
              <td>{date(data.exclusionDate)}</td>
              <td>{person.age ?? "—"}</td>
              <td>{money(person.invoicePlanAmount)}</td>
              <td>
                {person.payrollPlanAmount === null
                  ? "—"
                  : money(person.payrollPlanAmount)}
              </td>
              <td>{money(person.funeralAmount)}</td>
              <td>{usedDays}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="unimed-print-summary-grid">
        <div className="unimed-print-details">
          <strong className="unimed-print-section-title">
            Informações complementares
          </strong>
          <p>
            Competência da base cadastral: <strong>{baseCompetencyLabel}</strong>
          </p>
          <p>
            Fechamento do dia 25 aplicado?{" "}
            <strong>{afterCutoff ? "SIM" : "NÃO"}</strong>
          </p>
          {afterCutoff ? (
            <p>
              Competência integral adicional:{" "}
              <strong>{nextCompetencyLabel}</strong>
            </p>
          ) : null}
          <p>
            Tipo de rescisão: <strong>{data.reason || "—"}</strong>
          </p>
          <p>
            Meses de contribuição:{" "}
            <strong>{data.result.contributionMonths}</strong>
          </p>
          <p>
            Inclusão: <strong>{date(data.planEnrollmentDate)}</strong>
          </p>
          <p>
            Data de exclusão: <strong>{date(data.exclusionDate)}</strong>
          </p>
          <p>
            CPF do Titular: <strong>{data.cpf || "—"}</strong>
          </p>
        </div>

        <div className="unimed-print-legend">
          <strong>Legenda de Planos</strong>
          <span>01 - Unimed</span>
          <span>02 - Unimed + Acessório Funeral</span>
          <span>Documento: {documentName(data.result.documentKind)}</span>
          {data.includePayrollLoans ? (
            <section className={`unimed-print-loans${loanDensity}`}>
              <strong>Consignado digital</strong>
              {data.payrollLoans ? (
                <>
                  <span className="unimed-print-loan-total">
                    Empréstimo Consignado: {money(data.payrollLoans.totalAmount)}
                  </span>
                  {data.payrollLoans.contracts.length > 0 ? (
                    <div className="unimed-print-loan-list">
                      {data.payrollLoans.contracts.map((contract) => (
                        <div
                          className="unimed-print-loan-contract"
                          key={`${contract.bankCode}:${contract.contractNumber}`}
                        >
                          <span>
                            Valor: <b>{money(contract.installmentAmount)}</b> ·
                            Início: <b>{competence(contract.startCompetence)}</b> ·
                            Fim: <b>{competence(contract.endCompetence)}</b>
                          </span>
                          <span>
                            Contrato: <b>{contract.contractNumber || "—"}</b> ·
                            Banco:{" "}
                            <b>
                              {contract.bankCode || "—"} -{" "}
                              {contract.bankName || "—"}
                            </b>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="unimed-print-loan-empty">
                      Não há consignado digital na competência{" "}
                      {competence(data.payrollLoans.competence)}.
                    </span>
                  )}
                </>
              ) : (
                <span className="unimed-print-loan-empty">
                  Não há consignado digital para o CPF consultado.
                </span>
              )}
            </section>
          ) : null}
        </div>

        <dl className="unimed-print-totals">
          <div>
            <dt>Proporcional de {currentCompetencyLabel} ({data.result.refundDays} dias)</dt>
            <dd>{money(data.result.currentCompetencyRefund)}</dd>
          </div>
          {afterCutoff ? (
            <div>
              <dt>Mensalidade de {nextCompetencyLabel} ({data.result.nextCompetencyDays} dias)</dt>
              <dd>{money(data.result.nextCompetencyRefund)}</dd>
            </div>
          ) : null}
          <div className="calculation-total">
            <dt>Total estornado em fatura ({data.result.totalRefundDays} dias)</dt>
            <dd>{money(data.result.invoiceRefund)}</dd>
          </div>
          <div className="refund-highlight">
            <dt>Estorno ao funcionário</dt>
            <dd>{money(data.result.employeeFullRefund)}</dd>
          </div>
          <div className="refund-highlight">
            <dt>Estorno à empresa</dt>
            <dd>{money(data.result.companyFullRefund)}</dd>
          </div>
        </dl>
      </div>

      <footer className="unimed-print-footer">
        <span>Mês com {daysInMonth} dias</span>
        <span>{usedDays} dias utilizados</span>
        <span>{data.result.totalRefundDays} dias devolvidos em fatura</span>
        <span>
          {data.result.refundDays} dias de {currentCompetencyLabel}
          {afterCutoff
            ? ` + ${data.result.nextCompetencyDays} dias de ${nextCompetencyLabel}`
            : ""}
        </span>
        <span>
          Acessório Funeral identificado automaticamente por beneficiário
        </span>
      </footer>
    </section>
  );
}

export function UnimedPrintSummary({
  data,
}: {
  data: UnimedPrintSummaryData | null;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  if (!data || !portalTarget) return null;

  return createPortal(
    <div className="unimed-print-root" aria-hidden="true">
      <style>{`
        .unimed-print-root { display: none; }
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body > :not(.unimed-print-root) { display: none !important; }
          .unimed-print-root {
            display: block !important;
            width: 281mm;
            margin: 0;
            color: #000;
            background: #fff;
            font-family: Arial, Helvetica, sans-serif;
          }
          .unimed-print-copy {
            box-sizing: border-box;
            width: 281mm;
            height: 194mm;
            margin: 0;
            padding: 3mm;
            border: .45mm solid #000;
            overflow: hidden;
            break-after: page;
            page-break-after: always;
          }
          .unimed-print-copy:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .unimed-print-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-height: 7mm;
            padding: 0 1.5mm;
            border: .25mm solid #000;
            border-bottom: 0;
            font-size: 8pt;
          }
          .unimed-print-title strong { font-size: 11pt; }
          .unimed-print-table {
            width: 100%;
            table-layout: fixed;
            border-collapse: collapse;
            font-size: 6.3pt;
          }
          .unimed-print-table th,
          .unimed-print-table td {
            height: 7mm;
            padding: .7mm;
            border: .25mm solid #000;
            text-align: center;
            vertical-align: middle;
            overflow: hidden;
            line-height: 1.12;
          }
          .unimed-print-table th {
            height: 6mm;
            background: #e5e7eb !important;
            font-size: 6pt;
            font-weight: 800;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .unimed-print-table td { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .unimed-print-table .name-cell { text-align: left; font-weight: 700; }
          .col-registration { width: 15mm; }
          .col-branch { width: 8mm; }
          .col-name { width: 47mm; }
          .col-reason { width: 24mm; }
          .col-date { width: 18mm; }
          .col-plan { width: 9mm; }
          .col-age { width: 10mm; }
          .col-money { width: 19mm; }
          .col-days { width: 17mm; }
          .unimed-print-summary-grid {
            display: grid;
            grid-template-columns: 1.05fr .8fr 1.05fr;
            min-height: 50mm;
            margin-top: 3mm;
            border: .25mm solid #000;
            font-size: 7pt;
          }
          .unimed-print-details,
          .unimed-print-legend,
          .unimed-print-totals { padding: 2mm; }
          .unimed-print-details,
          .unimed-print-legend { border-right: .25mm solid #000; }
          .unimed-print-details p { margin: 0 0 2mm; }
          .unimed-print-section-title {
            display: block;
            margin-bottom: 2.5mm;
            font-size: 7.5pt;
          }
          .unimed-print-legend { display: flex; flex-direction: column; gap: 2mm; }
          .unimed-print-loans {
            display: flex;
            flex-direction: column;
            gap: 1mm;
            margin-top: 1mm;
            padding-top: 1.5mm;
            border-top: .2mm solid #6b7280;
            font-size: 6pt;
            line-height: 1.15;
          }
          .unimed-print-loans > strong { font-size: 7pt; }
          .unimed-print-loan-total { font-weight: 800; }
          .unimed-print-loan-list { display: grid; gap: .8mm; }
          .unimed-print-loan-contract {
            display: flex;
            flex-direction: column;
            gap: .25mm;
            padding-top: .7mm;
            border-top: .15mm solid #d1d5db;
            overflow-wrap: anywhere;
          }
          .unimed-print-loans.is-compact {
            gap: .65mm;
            font-size: 5.4pt;
          }
          .unimed-print-loans.is-compact .unimed-print-loan-list { gap: .45mm; }
          .unimed-print-loans.is-compact .unimed-print-loan-contract {
            gap: 0;
            padding-top: .4mm;
          }
          .unimed-print-loans.is-dense {
            gap: .35mm;
            font-size: 4.8pt;
            line-height: 1.05;
          }
          .unimed-print-loans.is-dense .unimed-print-loan-list { gap: .25mm; }
          .unimed-print-loans.is-dense .unimed-print-loan-contract {
            gap: 0;
            padding-top: .25mm;
          }
          .unimed-print-loan-empty { color: #4b5563; font-style: italic; }
          .unimed-print-totals { margin: 0; font-size: 6.4pt; }
          .unimed-print-totals div {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 2mm;
            padding: 1mm 0;
            border-bottom: .2mm solid #9ca3af;
          }
          .unimed-print-totals dt { font-weight: 700; }
          .unimed-print-totals dd { margin: 0; font-weight: 800; }
          .unimed-print-totals .refund-highlight {
            margin: 0 -1mm;
            padding: 1.25mm 1mm;
            border: .25mm solid #111827;
            background: #f3f4f6 !important;
            font-size: 7.5pt;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .unimed-print-totals .calculation-total { border-bottom: 0; font-weight: 800; }
          .unimed-print-footer {
            display: flex;
            justify-content: space-between;
            gap: 3mm;
            margin-top: 3mm;
            padding: 2mm;
            border: .25mm solid #000;
            font-size: 6.5pt;
            font-weight: 700;
          }
        }
      `}</style>
      <UnimedPrintCopy copy={1} data={data} />
      <UnimedPrintCopy copy={2} data={data} />
    </div>,
    portalTarget,
  );
}
