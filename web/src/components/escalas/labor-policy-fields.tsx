"use client";

import type { EscalaInput, EscalaPolicy } from "@/lib/escalas/types";
import { transitionWeeks } from "@/lib/escalas/labor-rules";
import { Check, controlClass, Field } from "./controls";
import { addDate, displayDate, selectNormativeProfile } from "./workspace-model";

type Props = { input: EscalaInput; onChange: (input: EscalaInput) => void };
type Agreement = NonNullable<EscalaPolicy["collectiveAgreement"]>;
type Certificate = NonNullable<EscalaPolicy["operationalCertificate"]>;

export function LaborPolicyFields({ input, onChange }: Props) {
  const policy = input.policy;
  const transitions = transitionWeeks(input);
  const agreement: Agreement = policy.collectiveAgreement ?? {
    source: "",
    validFrom: "",
    validUntil: "",
    reviewedBy: "",
    reviewed: false,
  };
  const certificate: Certificate = policy.operationalCertificate ?? {
    identifier: "",
    validFrom: "",
    validUntil: "",
    reviewedBy: "",
    reviewed: false,
    sundays: false,
    holidays: false,
    after20: false,
  };
  function change(patch: Partial<EscalaPolicy>) {
    onChange({ ...input, policy: { ...policy, reviewed: false, ...patch } });
  }
  function changeAgreement<K extends keyof Agreement>(field: K, value: Agreement[K]) {
    change({ collectiveAgreement: { ...agreement, reviewed: false, [field]: value } });
  }
  function changeCertificate<K extends keyof Certificate>(field: K, value: Certificate[K]) {
    change({ operationalCertificate: { ...certificate, reviewed: false, [field]: value } });
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-[color:var(--app-border)] p-3 text-sm">
        <h3 className="font-semibold">Jornadas e transição de vigência</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Até 15/12/2026: teto semanal de 44 horas.</li>
          <li>
            De 16/12/2026 a 15/12/2027: teto de 42 horas; até 8h24 por dia neste regime 5×2, com instrumento coletivo
            válido.
          </li>
          <li>Desde 16/12/2027: teto de 40 horas e jornada de até 8h00 neste regime 5×2.</li>
        </ul>
        <p>
          O cálculo respeita a carga contratual menor: um contrato de 40 horas não aumenta para 42 horas. Os horários
          devem permitir a carga vigente de cada semana.
        </p>
        <a
          className="underline"
          href="https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm"
          target="_blank"
          rel="noreferrer"
        >
          Consultar a EC 141/2026
        </a>
      </div>
      {transitions.length > 0 && (
        <div className="space-y-2 rounded-lg border border-[color:var(--app-border)] p-3 text-sm">
          <p>
            Semanas que atravessam a mudança:{" "}
            {transitions.map((start) => `${displayDate(start)} a ${displayDate(addDate(start, 6))}`).join("; ")}. A
            proposta usa a carga menor para a semana completa; a publicação exige confirmar essa adequação antecipada,
            sem rateio automático.
          </p>
          <Check
            label="Adotar carga menor em toda a semana de transição"
            checked={policy.transitionWeekAccepted ?? false}
            onChange={(value) => change({ transitionWeekAccepted: value })}
          />
        </div>
      )}
      <Field
        label="Enquadramento da norma coletiva"
        hint="Selecione somente o instrumento que abrange a filial e a categoria. A seleção não certifica sua aplicação."
      >
        {(id) => (
          <select
            id={id}
            className={controlClass}
            value={policy.normativeProfile ?? "CUSTOM"}
            onChange={(event) => {
              const normativeProfile = event.target.value as NonNullable<EscalaPolicy["normativeProfile"]>;
              onChange(selectNormativeProfile(input, normativeProfile));
            }}
          >
            <option value="CUSTOM">Outra norma ou enquadramento em revisão</option>
            <option value="SINDECOMU_SUPERMARKETS_2026_2027">SINDECOMU — Supermercados de Umuarama 2026/2027</option>
          </select>
        )}
      </Field>
      {policy.normativeProfile === "SINDECOMU_SUPERMARKETS_2026_2027" && (
        <div className="space-y-3 text-sm">
          <p>
            CCT PR003084/2026, de 01/06/2026 a 31/05/2027. A cláusula 29 não afasta o descanso dominical quinzenal das
            mulheres (art. 386 da CLT). A cláusula 28 veda atendimento ao público em 25/12, 01/01 e 01/05; não significa
            fechamento automático de toda atividade interna.
          </p>
          <p>
            O banco de horas de 90 dias não está implantado. O cadastro da CCT não substitui a autorização específica
            para a distribuição de 42 horas.
          </p>
          <a className="underline" href="https://sindecomu.com.br/" target="_blank" rel="noreferrer">
            Consultar o SINDECOMU
          </a>
          <details className="space-y-3 border-t border-[color:var(--app-border)] pt-2">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">
              Certidão prévia de funcionamento — cláusula 46
            </summary>
            <p>
              Informe a certidão válida e os regimes efetivamente autorizados. Domingos, feriados, prorrogação e
              trabalho noturno após 20h exigem conferência própria. A CCT homologada não é a certidão individual da
              empresa.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Identificação da certidão">
                {(id) => (
                  <input
                    id={id}
                    className={controlClass}
                    maxLength={1000}
                    value={certificate.identifier}
                    onChange={(event) => changeCertificate("identifier", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Responsável pela conferência da certidão">
                {(id) => (
                  <input
                    id={id}
                    className={controlClass}
                    maxLength={160}
                    value={certificate.reviewedBy}
                    onChange={(event) => changeCertificate("reviewedBy", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Início da validade da certidão">
                {(id) => (
                  <input
                    id={id}
                    className={controlClass}
                    type="date"
                    value={certificate.validFrom}
                    onChange={(event) => changeCertificate("validFrom", event.target.value)}
                  />
                )}
              </Field>
              <Field label="Fim da validade da certidão">
                {(id) => (
                  <input
                    id={id}
                    className={controlClass}
                    type="date"
                    value={certificate.validUntil}
                    onChange={(event) => changeCertificate("validUntil", event.target.value)}
                  />
                )}
              </Field>
            </div>
            <Check
              label="Certidão autoriza domingos"
              checked={certificate.sundays}
              onChange={(value) => changeCertificate("sundays", value)}
            />
            <Check
              label="Certidão autoriza feriados"
              checked={certificate.holidays}
              onChange={(value) => changeCertificate("holidays", value)}
            />
            <Check
              label="Certidão autoriza prorrogação e trabalho noturno após 20h"
              checked={certificate.after20}
              onChange={(value) => changeCertificate("after20", value)}
            />
            <Check
              label="Conferi a certidão, a filial, a vigência e os regimes autorizados"
              checked={certificate.reviewed}
              onChange={(value) => changeCertificate("reviewed", value)}
            />
          </details>
        </div>
      )}
      <details className="space-y-3 border-t border-[color:var(--app-border)] pt-2">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Instrumento coletivo para a jornada de até 8h24
        </summary>
        <p className="text-sm text-[color:var(--app-muted)]">
          Preencha somente um acordo ou convenção efetivamente firmado, aplicável à filial e válido para as datas
          trabalhadas. A autorização geral de compensação também precisa estar marcada. Este registro não prorroga o
          regime além de 15/12/2027.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Identificação e cláusula do instrumento coletivo">
            {(id) => (
              <input
                id={id}
                className={controlClass}
                maxLength={1000}
                value={agreement.source}
                onChange={(event) => changeAgreement("source", event.target.value)}
              />
            )}
          </Field>
          <Field label="Responsável pela conferência do instrumento">
            {(id) => (
              <input
                id={id}
                className={controlClass}
                maxLength={160}
                value={agreement.reviewedBy}
                onChange={(event) => changeAgreement("reviewedBy", event.target.value)}
              />
            )}
          </Field>
          <Field label="Início da vigência do instrumento">
            {(id) => (
              <input
                id={id}
                className={controlClass}
                type="date"
                value={agreement.validFrom}
                onChange={(event) => changeAgreement("validFrom", event.target.value)}
              />
            )}
          </Field>
          <Field label="Fim da vigência do instrumento">
            {(id) => (
              <input
                id={id}
                className={controlClass}
                type="date"
                value={agreement.validUntil}
                onChange={(event) => changeAgreement("validUntil", event.target.value)}
              />
            )}
          </Field>
        </div>
        <Check
          label="Conferi o instrumento coletivo firmado e a autorização da jornada de até 8h24"
          checked={agreement.reviewed}
          onChange={(value) => changeAgreement("reviewed", value)}
        />
      </details>
    </div>
  );
}
