"use client";

import { CalendarDays, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WeeklyHours } from "@/lib/escalas/types";
import { compareBranches } from "@/lib/escalas/order";
import { Rules, Shifts } from "./configuration";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import { Coverage, ImportEmployees } from "./coverage-import";
import { Employees } from "./employees";
import { Proposals, Publication, ValidationResults } from "./results";
import { Roster } from "./roster";
import { useEscalasWorkspace, type WorkspaceSummary } from "./use-escalas-workspace";
import { changeBranchWeeklyHours, displayDate, errorMessage, HOURS, monthPeriod, newInput } from "./workspace-model";
import type { ReviewTarget } from "./validation-guidance";
import { HoursProposal } from "./hours-proposal";
import { DeletePlan } from "./delete-plan";
import { visibleDates } from "@/lib/escalas/dates";

function CreatePlan({ disabled, create }: { disabled: boolean; create: (input: ReturnType<typeof newInput>) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [hours, setHours] = useState<WeeklyHours>(40);
  const [error, setError] = useState("");
  let periodLabel = "";
  try {
    const period = monthPeriod(month);
    const dates = visibleDates({ ...period, visibleMonth: month });
    periodLabel = `${displayDate(dates[0])} a ${displayDate(dates.at(-1) ?? dates[0])}`;
  } catch {
    /* The form reports the invalid month on submit. */
  }
  return (
    <details className={panelClass}>
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Criar proposta para uma filial</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          try {
            if (!code.trim()) throw new Error("Informe o código da filial.");
            create(newInput(code, name.trim() || `Filial ${code.trim()}`, month, hours));
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
            <Field label="Nome da filial (opcional)">
              {(id) => (
                <input
                  id={id}
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
            Mês completo: <strong>{periodLabel || "informe o mês"}</strong>. As semanas nas fronteiras são conferidas internamente, sem incluir dias de outros meses na grade e nos totais mensais.
          </p>
          {error && (
            <p role="alert" className="text-sm text-[color:var(--app-coral)]">
              {error}
            </p>
          )}
          <button type="submit" className={primaryClass}>
            Iniciar planejamento
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
  const [review, setReview] = useState<ReviewTarget | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (model.error) errorRef.current?.focus(); }, [model.error]);
  function resolve(target: ReviewTarget) {
    if (target === "generate") {
      if (input) model.generate();
      return;
    }
    setReview(target);
    requestAnimationFrame(() => {
      const element = document.getElementById(`escala-${target}`);
      if (element instanceof HTMLDetailsElement) element.open = true;
      element?.scrollIntoView({ behavior: "instant", block: "start" });
      element?.focus({ preventScroll: true });
    });
  }
  return (
    <div className="min-w-0 space-y-6 text-[color:var(--app-fg)]">
      <header className="space-y-3 border-b border-[color:var(--app-border)] pb-5">
        <div className="flex items-center gap-3">
          <CalendarDays className="size-8 shrink-0 text-[color:var(--app-teal)]" aria-hidden="true" />
          <h1 className="text-2xl font-bold">Escalas 5×2</h1>
        </div>
        <p className="max-w-3xl text-sm text-[color:var(--app-muted)]">
          Simule o mês, distribua folgas e ajuste a proposta da filial. Sábados e domingos fazem parte da operação. O assistente aponta limites e cobertura, sem substituir a conferência das regras aplicáveis.
        </p>
        <ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold" aria-label="Etapas do planejamento">
          <li>1. Importar equipe</li>
          <li>2. Gerar proposta</li>
          <li>3. Ajustar e exportar</li>
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
                    Filial {item.input.branchCode} · {item.input.branchName} · {displayDate(visibleDates(item.input)[0])} a{" "}
                    {displayDate(visibleDates(item.input).at(-1) ?? item.input.endDate)} · revisão {item.revision} ·{" "}
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
          ref={errorRef}
          tabIndex={-1}
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
              {displayDate(visibleDates(input)[0])} a {displayDate(visibleDates(input).at(-1) ?? input.endDate)} · Revisão salva {workspace.revision} ·{" "}
              {workspace.status === "PUBLISHED" ? "Publicada" : "Rascunho"}
              {model.dirty ? " · Alterações locais não salvas" : ""}
            </p>
            <DeletePlan workspace={workspace} dirty={model.dirty} busy={Boolean(model.busy)} onDelete={model.deleteWorkspace} />
            {!workspace.canEdit && (
              <p className="text-sm text-[color:var(--app-muted)]">
                Acesso de consulta. Alterações dependem da permissão de planejamento desta filial.
              </p>
            )}
          </div>
          <section id="escala-team" tabIndex={-1} className="space-y-3">
            <h2 className="text-lg font-bold">1. Equipe da filial</h2>
            <p className="text-sm">{input.employees.length} colaboradores cadastrados · {input.employees.filter((person) => person.planningEnabled !== false).length} incluídos · {input.employees.filter((person) => person.planningEnabled === false).length} não incluídos (motivos nos ajustes da equipe)</p>
            <ImportEmployees input={input} disabled={!model.canEdit} onChange={model.update} />
          </section>
          <section className={`${panelClass} border-[color:var(--app-teal)]`} aria-labelledby="escala-mass-title">
            <h2 id="escala-mass-title" className="text-lg font-bold">2. Gerar proposta mensal</h2>
            <p className="text-sm">A análise prepara as alternativas válidas de horário e distribui trabalho e folgas da equipe. As folgas podem ser separadas. Dias bloqueados, ausências, horários importados e contratos menores são preservados.</p>
            <fieldset disabled={!model.canEdit} className="max-w-md space-y-3">
              <Field label="Carga semanal de referência" hint="O limite legal de cada semana e os contratos menores continuam sendo respeitados.">
                {(id) => <select id={id} value={input.defaultWeeklyHours} className={controlClass} onChange={(event) => model.update(changeBranchWeeklyHours(input, Number(event.target.value) as WeeklyHours))}>
                  {HOURS.map((hours) => <option key={hours} value={hours}>{hours} horas</option>)}
                </select>}
              </Field>
              {input.defaultWeeklyHours > 40 && <p className="text-sm">Mais de 40 horas em cinco dias pode exigir autorização específica para exceder oito horas diárias. Sem autorização real, use 40h para simular ou confira a exceção nas regras avançadas.</p>}
            </fieldset>
            {input.employees.length > 0 && <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Conferir ou ajustar alternativas de horário (opcional)</summary><HoursProposal input={input} disabled={!model.canEdit} onChange={model.update} /></details>}
            <button
              type="button"
              className={primaryClass}
              disabled={!model.canEdit || !input.employees.some((person) => person.planningEnabled !== false)}
              onClick={model.generate}
            >
              Gerar proposta mensal
            </button>
            <p className="max-w-2xl text-sm text-[color:var(--app-muted)]">
              Alterações aplicadas serão salvas antes da análise. Você confere a prévia e decide quando aplicar.
              A geração não publica a escala.
            </p>
          </section>
          <Proposals
            input={input}
            generated={model.generated}
            disabled={!model.canEdit}
            onGenerated={model.applyGenerated}
            onDismiss={model.dismissProposals}
          />
          <section id="escala-roster" tabIndex={-1} className="space-y-3">
          <h2 className="text-lg font-bold">3. Revisar, ajustar e exportar</h2>
          {input.assignments.length > 0 && <Roster
            input={input}
            validation={model.validation}
            disabled={!model.canEdit}
            canUnlock={workspace.canPublish}
            onChange={model.update}
          />}
          <ValidationResults input={input} validation={model.validation} onResolve={model.canEdit ? resolve : undefined} />
          </section>
          <details id="escala-rules" tabIndex={-1} className={panelClass} open={review === "rules"} onToggle={(event) => { if (!event.currentTarget.open && review === "rules") setReview(null); }}>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">Regras especiais e autorizações · opcionais para simular</summary>
            <Rules input={input} disabled={!model.canEdit} onChange={model.update} />
          </details>
          <details id="escala-coverage" tabIndex={-1} className={panelClass} open={review === "coverage"} onToggle={(event) => { if (!event.currentTarget.open && review === "coverage") setReview(null); }}>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">Cobertura por setor · conferir a estimativa antes de publicar</summary>
            <Coverage input={input} disabled={!model.canEdit} onChange={model.update} />
          </details>
          <details id="escala-advanced" className={panelClass}>
            <summary className="min-h-11 cursor-pointer py-2 font-semibold">Ajustes avançados e exceções (opcional)</summary>
            <div className="space-y-6">
              <Employees input={input} disabled={!model.canEdit} onChange={model.update} />
              <Shifts input={input} disabled={!model.canEdit} onChange={model.update} />
              <div className="flex flex-wrap gap-3">
                <button type="button" className={buttonClass} disabled={!model.canEdit} onClick={model.validate}>Conferir dados exibidos</button>
                <button type="button" className={buttonClass} disabled={!model.dirty || Boolean(model.busy)} onClick={model.discard}>Descartar alterações locais</button>
              </div>
            </div>
          </details>
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
