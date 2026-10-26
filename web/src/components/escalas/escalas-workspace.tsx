"use client";

import { CalendarDays, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { WeeklyHours } from "@/lib/escalas/types";
import { compareBranches } from "@/lib/escalas/order";
import { Rules, Shifts } from "./configuration";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import { Coverage, ImportEmployees } from "./coverage-import";
import { Employees } from "./employees";
import { Proposals, Publication, ValidationResults } from "./results";
import { Roster } from "./roster";
import { useEscalasWorkspace, type WorkspaceSummary } from "./use-escalas-workspace";
import { displayDate, errorMessage, HOURS, monthPeriod, newInput } from "./workspace-model";

function CreatePlan({ disabled, create }: { disabled: boolean; create: (input: ReturnType<typeof newInput>) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [hours, setHours] = useState<WeeklyHours>(42);
  const [error, setError] = useState("");
  let periodLabel = "";
  try {
    const period = monthPeriod(month);
    periodLabel = `${displayDate(period.startDate)} a ${displayDate(period.endDate)}`;
  } catch {
    /* The form reports the invalid month on submit. */
  }
  return (
    <details className={panelClass} open>
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Criar proposta para uma filial</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          try {
            if (!code.trim() || !name.trim()) throw new Error("Informe o código e o nome da filial.");
            create(newInput(code, name, month, hours));
          } catch (cause) {
            setError(errorMessage(cause));
          }
        }}
      >
        <fieldset disabled={disabled} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Código da filial">
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={40}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className={controlClass}
                />
              )}
            </Field>
            <Field label="Nome da filial">
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={controlClass}
                />
              )}
            </Field>
            <Field label="Mês de referência">
              {(id) => (
                <input
                  id={id}
                  required
                  type="month"
                  min="2000-02"
                  max="2099-11"
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className={controlClass}
                />
              )}
            </Field>
            <Field label="Carga semanal padrão">
              {(id) => (
                <select
                  id={id}
                  value={hours}
                  onChange={(event) => setHours(Number(event.target.value) as WeeklyHours)}
                  className={controlClass}
                >
                  {HOURS.map((value) => (
                    <option key={value} value={value}>
                      {value} horas
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <p className="text-sm text-[color:var(--app-muted)]">
            Período com semanas completas, de segunda a domingo: <strong>{periodLabel || "informe o mês"}</strong>. Dias
            do mês anterior e seguinte entram na conferência das fronteiras.
          </p>
          {error && (
            <p role="alert" className="text-sm text-[color:var(--app-coral)]">
              {error}
            </p>
          )}
          <button type="submit" className={primaryClass}>
            Criar proposta vazia
          </button>
        </fieldset>
      </form>
    </details>
  );
}

function comparePlans(a: WorkspaceSummary, b: WorkspaceSummary) {
  return (
    compareBranches(a.input, b.input) || b.input.startDate.localeCompare(a.input.startDate) || a.id.localeCompare(b.id)
  );
}

export function EscalasStatus({
  busy,
  notice,
  cancellable,
  onCancel,
}: {
  busy: string;
  notice: string;
  cancellable: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <p role="status" aria-live="polite" aria-atomic="true">
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            {busy}
          </span>
        ) : (
          notice
        )}
      </p>
      {busy && cancellable && (
        <button type="button" className={buttonClass} onClick={onCancel}>
          Cancelar análise
        </button>
      )}
    </div>
  );
}

export function EscalasWorkspace() {
  const model = useEscalasWorkspace();
  const { input, workspace } = model;
  return (
    <div className="min-w-0 space-y-6 text-[color:var(--app-fg)]">
      <header className="space-y-3 border-b border-[color:var(--app-border)] pb-5">
        <div className="flex items-center gap-3">
          <CalendarDays className="size-8 shrink-0 text-[color:var(--app-teal)]" aria-hidden="true" />
          <h1 className="text-2xl font-bold">Escalas 5×2</h1>
        </div>
        <p className="max-w-3xl text-sm text-[color:var(--app-muted)]">
          Planeje jornadas e folgas por filial, setor e cargo. Sábados e domingos fazem parte da operação; a conferência
          considera horários reais, descansos e cobertura.
        </p>
        <ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold" aria-label="Etapas do planejamento">
          <li>1. Equipe</li>
          <li>2. Regras e horários</li>
          <li>3. Cobertura</li>
          <li>4. Proposta</li>
          <li>5. Conferência</li>
          <li>6. Publicação interna</li>
        </ol>
      </header>
      <section className={panelClass} aria-labelledby="escala-list-title">
        <h2 id="escala-list-title" className="font-bold">
          Propostas e escalas por filial
        </h2>
        {model.workspaces.length ? (
          <Field label="Selecionar filial e período">
            {(id) => (
              <select
                id={id}
                disabled={Boolean(model.busy)}
                value={workspace?.id ?? ""}
                onChange={(event) => {
                  if (event.target.value) model.open(event.target.value);
                }}
                className={controlClass}
              >
                <option value="">Selecione uma proposta</option>
                {[...model.workspaces].sort(comparePlans).map((item) => (
                  <option key={item.id} value={item.id}>
                    Filial {item.input.branchCode} · {item.input.branchName} · {displayDate(item.input.startDate)} a{" "}
                    {displayDate(item.input.endDate)} · revisão {item.revision} ·{" "}
                    {item.status === "PUBLISHED" ? "Publicada" : "Rascunho"}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <p className="text-sm text-[color:var(--app-muted)]">
            Nenhuma proposta disponível para seu acesso. Um administrador pode iniciar o cadastro da filial.
          </p>
        )}
      </section>
      {model.pendingOpen && (
        <div className={`${panelClass} border-[color:var(--app-coral)]`} role="alert">
          <p>Há alterações locais não salvas. Elas serão perdidas ao trocar de proposta.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass} onClick={() => model.setPendingOpen(null)}>
              Continuar editando
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                if (model.pendingOpen) model.open(model.pendingOpen, true);
              }}
            >
              Descartar alterações e abrir
            </button>
          </div>
        </div>
      )}
      {model.canCreate && <CreatePlan disabled={Boolean(model.busy || model.dirty)} create={model.create} />}
      <EscalasStatus
        busy={model.busy}
        notice={model.notice}
        cancellable={model.cancellable}
        onCancel={model.cancelAnalysis}
      />
      {model.error && (
        <div
          className="app-radius-lg border border-[color:var(--app-coral)] bg-[color:var(--app-danger-soft)] p-4 text-sm"
          role="alert"
        >
          {model.error}
        </div>
      )}
      {input && workspace && (
        <div key={`${workspace.id}-${model.resetKey}`} className="space-y-6">
          <div className="space-y-3 border-b border-[color:var(--app-border)] pb-4">
            <h2 className="text-xl font-bold">
              Filial {input.branchCode} · {input.branchName}
            </h2>
            <p className="text-sm">
              {displayDate(input.startDate)} a {displayDate(input.endDate)} · Revisão salva {workspace.revision} ·{" "}
              {workspace.status === "PUBLISHED" ? "Publicada" : "Rascunho"}
              {model.dirty ? " · Alterações locais não salvas" : ""}
            </p>
            {!workspace.canEdit && (
              <p className="text-sm text-[color:var(--app-muted)]">
                Acesso de consulta. Alterações dependem da permissão de planejamento desta filial.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={primaryClass}
                disabled={!model.canEdit || !model.dirty}
                onClick={model.save}
              >
                Salvar e conferir revisão
              </button>
              <button type="button" className={buttonClass} disabled={!model.canEdit} onClick={model.validate}>
                Conferir dados exibidos
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={!model.dirty || Boolean(model.busy)}
                onClick={model.discard}
              >
                Descartar alterações locais
              </button>
            </div>
            <p className="text-xs text-[color:var(--app-muted)]">
              A conferência usa os dados aplicados à proposta. Clique em “Aplicar” nos cadastros ainda abertos antes de
              salvar ou conferir.
            </p>
          </div>
          <Employees input={input} disabled={!model.canEdit} onChange={model.update} />
          <ImportEmployees input={input} disabled={!model.canEdit} onChange={model.update} />
          <details className={panelClass}>
            <summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">
              Configurar regras, horários e cobertura
            </summary>
            <div className="space-y-6">
              <Rules input={input} disabled={!model.canEdit} onChange={model.update} />
              <Shifts input={input} disabled={!model.canEdit} onChange={model.update} />
              <Coverage input={input} disabled={!model.canEdit} onChange={model.update} />
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={primaryClass}
              disabled={!model.canEdit || model.dirty || !input.employees.length}
              onClick={model.generate}
            >
              Gerar proposta de folgas
            </button>
            <p className="max-w-2xl text-sm text-[color:var(--app-muted)]">
              Aplique e salve as configurações primeiro. A geração preserva decisões bloqueadas e entrega uma prévia
              para conferência, sem publicação automática.
            </p>
          </div>
          <Proposals
            input={input}
            generated={model.generated}
            suggestions={model.suggestions}
            disabled={!model.canEdit}
            onGenerated={model.applyGenerated}
            onSuggestion={model.applySuggestion}
            onDismiss={model.dismissProposals}
          />
          <Roster
            input={input}
            validation={model.validation}
            disabled={!model.canEdit}
            canUnlock={workspace.canPublish}
            canSuggest={model.canEdit && !model.dirty}
            onChange={model.update}
            onSuggest={model.suggest}
          />
          <ValidationResults input={input} validation={model.validation} />
          {model.dirty && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={primaryClass} disabled={!model.canEdit} onClick={model.save}>
                Salvar e conferir revisão
              </button>
              <span className="text-sm">As alterações só estarão disponíveis para outros usuários após salvar.</span>
            </div>
          )}
          <Publication
            key={`${workspace.id}:${workspace.revision}`}
            workspace={workspace}
            validation={model.validation}
            dirty={model.dirty}
            busy={Boolean(model.busy)}
            onPublish={model.publish}
          />
        </div>
      )}
    </div>
  );
}
