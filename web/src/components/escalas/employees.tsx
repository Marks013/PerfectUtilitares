"use client";

import { isEscalaPlanningParticipant } from "@/lib/escalas/eligibility";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { EscalaEmployee, EscalaInput } from "@/lib/escalas/types";
import { canAssignCatalogShift } from "@/lib/escalas/shift-catalog/reference-choices";
import { revealRecoveryElement, type EscalaRecoveryRequest } from "./recovery-navigation";
import { indexEmployees, searchEmployees } from "./employee-search";
import { canDisplayEscalaAction, useEscalaClientAccess } from "./access-context";
import { BulkControls } from "./bulk-controls";
import { ExcludedEmployees } from "./excluded-employees";
import { buttonClass, controlClass, Field, panelClass } from "./controls";
import { newEmployee } from "./workspace-model";
import { EmployeeEditor } from "./employee-editor";
import { EmployeeDraftDialog, useEmployeeEditing } from "./employee-editing";
import styles from "./escalas.module.css";

export { EmployeeEditor } from "./employee-editor";

export function Employees({
  input,
  disabled,
  onChange,
  review,
  onSwap,
  onRemoveEmployee,
  managedTeam = false,
  swapDisabled = false,
}: {
  input: EscalaInput;
  disabled: boolean;
  onChange: (input: EscalaInput) => void;
  review?: EscalaRecoveryRequest;
  onSwap?: (employee: EscalaEmployee) => void;
  onRemoveEmployee?: (employeeId: string) => Promise<boolean>;
  managedTeam?: boolean;
  swapDisabled?: boolean;
}) {
  const access = useEscalaClientAccess();
  const administrative = canDisplayEscalaAction(access, "settings.manage", input.branchCode);
  const canChangeTeam = canDisplayEscalaAction(access, "employee.manage", input.branchCode)
    && canDisplayEscalaAction(access, "workspace.save", input.branchCode);
  const canManage = !disabled && canChangeTeam;
  const showRemoval = !managedTeam && (administrative || (Boolean(onRemoveEmployee) && canChangeTeam));
  const editor = useEmployeeEditing(input.employees, canManage);
  const { editing, requestEdit, finishEditing, reportDirty } = editor;
  const [removing, setRemoving] = useState<string | null>(null);
  const [removalStatus, setRemovalStatus] = useState<"idle" | "saving" | "failed">("idle");
  const removalInFlight = useRef(false);
  const removalTrigger = useRef<HTMLElement | null>(null);
  const removalHeading = useRef<HTMLHeadingElement>(null);
  const removalTitle = useId();
  const [search, setSearch] = useState("");
  const reviewedRequest = useRef(0);
  useEffect(() => {
    if (removing) removalHeading.current?.focus();
  }, [removing]);
  useEffect(() => {
    if (!canManage || !review?.employeeId || reviewedRequest.current === review.request) return;
    const employee = input.employees.find((person) => person.id === review.employeeId);
    if (!employee) return;
    reviewedRequest.current = review.request;
    setSearch("");
    requestEdit(employee);
  }, [canManage, input.employees, review, requestEdit]);
  useEffect(() => {
    if (!review?.employeeId || editing?.id !== review.employeeId) return;
    const editor = document.getElementById("escala-employee-editor");
    if (editor) revealRecoveryElement(editor);
  }, [editing, review]);
  const searchInput = useRef<HTMLInputElement>(null);
  const employeeIndex = useMemo(() => indexEmployees(input.employees), [input.employees]);
  const employees = useMemo(() => searchEmployees(employeeIndex, search), [employeeIndex, search]);
  const included = employees.filter(isEscalaPlanningParticipant);
  const excluded = employees.filter(employee => !isEscalaPlanningParticipant(employee));
  const removingEmployee = showRemoval ? input.employees.find((employee) => employee.id === removing) : undefined;
  const protectedRemoval = removingEmployee && input.assignments.some(day => day.employeeId === removingEmployee.id &&
    (onRemoveEmployee ? day.locked !== false || day.kind === "ABSENCE" || day.kind === "HOLIDAY" : day.locked === true));
  const removalPending = removalStatus === "saving";

  function startRemoval(employee: EscalaEmployee) {
    if (!canManage || !showRemoval || removalInFlight.current) return;
    removalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRemovalStatus("idle");
    setRemoving(employee.id);
  }

  function cancelRemoval() {
    if (removalInFlight.current) return;
    setRemoving(null);
    setRemovalStatus("idle");
    removalTrigger.current?.focus();
  }

  async function confirmRemoval() {
    if (!removingEmployee || !canManage || protectedRemoval || removalInFlight.current) return;
    const employeeId = removingEmployee.id;
    if (onRemoveEmployee) {
      removalInFlight.current = true;
      setRemovalStatus("saving");
      try {
        if (!await onRemoveEmployee(employeeId)) {
          setRemovalStatus("failed");
          return;
        }
      } catch {
        setRemovalStatus("failed");
        return;
      } finally {
        removalInFlight.current = false;
      }
    } else {
      onChange({ ...input, employees: input.employees.filter(person => person.id !== employeeId), assignments: input.assignments.filter(day => day.employeeId !== employeeId) });
    }
    if (editing?.id === employeeId) finishEditing();
    setRemoving(null);
    setRemovalStatus("idle");
    searchInput.current?.focus();
  }

  return (
    <section className={panelClass} aria-labelledby="escala-employees-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="escala-employees-title" className="text-lg font-bold">
          1. Equipe da filial
        </h2>
        {administrative && !managedTeam && <button
          type="button"
          className={buttonClass}
          disabled={!canManage || input.employees.length >= 250}
          onClick={() => {
            const initial = input.shifts
              .filter((shift) => /^turno-inicial(?:-|$)/.test(shift.id))
              .map((shift) => shift.id);
            requestEdit(
              newEmployee(
                input.defaultWeeklyHours,
                initial.length ? initial : input.shifts.slice(0, 1).map((shift) => shift.id),
              ),
            );
          }}
        >
          Adicionar colaborador
        </button>}
      </div>
      {managedTeam ? <p className={styles.muted}>Cadastros e afastamentos são editados na base global. Ajustes de folga e turno continuam na proposta.</p> : administrative ? <>
        <p className="text-sm text-[color:var(--app-muted)]">
          A importação já prepara a equipe. Abra um cadastro somente para ajustar uma exceção. No editor, use Aplicar cadastro à proposta. Só depois as alterações entram no salvamento automático.
        </p>
        <BulkControls input={input} disabled={!canManage} onChange={onChange} />
      </> : <p className={styles.muted}>Para adicionar um colaborador, use um modelo de jornada aprovado pelo administrador.</p>}
      <Field label="Localizar colaborador, matrícula, setor ou cargo">
        {(id) => (
          <input
            id={id}
            type="search"
            ref={searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={controlClass}
          />
        )}
      </Field>
      {search && <button type="button" className={buttonClass} onClick={() => { setSearch(""); searchInput.current?.focus(); }}>Limpar busca de colaboradores</button>}
      <p role="status" className={styles.muted}>{employees.length} de {input.employees.length} colaborador(es) na consulta.</p>
      {!input.employees.length && (
        <p className="text-sm">{administrative ? "Nenhum colaborador cadastrado. Adicione a equipe ou importe o modelo abaixo." : "Nenhum colaborador cadastrado nesta filial."}</p>
      )}
      <section aria-label="Colaboradores incluídos" className="max-h-72 space-y-1 overflow-y-auto">
        {included.map((employee) => (
          <div
            key={employee.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--app-border)] py-2"
          >
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold">
                {employee.name} · {employee.registration}
              </p>
              <p className="text-xs text-[color:var(--app-muted)]">
                {employee.sector} / {employee.role} · {employee.scheduleMode === "MISSING"
                  ? "Sem horário fixo · folgas planejadas"
                  : employee.scheduleMode === "UNTIMED"
                  ? "ENC · sem horário fixo · folgas planejadas"
                  : `referência ${employee.weeklyHours}h`}
                {employee.maxConsecutiveSundays > 1 && employee.sundayRestRule !== "COMMERCE" &&
                  " · domingos: enquadramento pendente"}
                {employee.planningEnabled === false && " · fora do planejamento"}
              </p>
              {employee.planningEnabled === false && employee.planningExclusionReason && <p className="text-xs text-[color:var(--app-muted)]">{employee.planningExclusionReason}</p>}
              {employee.sourceSchedule && <p className="break-words text-xs text-[color:var(--app-muted)]">
                Referência FPRE136: {employee.sourceSchedule.code} · {employee.sourceSchedule.description}
                {" · Dias úteis: "}{employee.sourceSchedule.weekday || "não informado"}
                {" · Sábado: "}{employee.sourceSchedule.saturday || "não informado"}
              </p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} disabled={!canManage} onClick={() => requestEdit(employee)}>
                Editar<span className="sr-only"> {employee.name}</span>
              </button>
              {onSwap && input.generationMode !== "REST_ONLY" && canAssignCatalogShift(employee) && <button type="button" className={buttonClass} disabled={swapDisabled} onClick={() => onSwap(employee)}>
                Trocar turno<span className="sr-only"> de {employee.name}</span>
              </button>}
              {showRemoval && <button
                type="button"
                className={buttonClass}
                disabled={
                  !canManage || removalPending ||
                  (!onRemoveEmployee && input.assignments.some(day => day.employeeId === employee.id && day.locked))
                }
                onClick={() => startRemoval(employee)}
              >
                Remover
                <span className="sr-only"> {employee.name} da proposta</span>
              </button>}
            </div>

          </div>
        ))}
      </section>
      {!included.length && input.employees.length > 0 && <p className="text-sm">Nenhum colaborador incluído corresponde à busca. Confira a relação de não incluídos abaixo.</p>}
      <ExcludedEmployees employees={excluded} disabled={!canManage || removalPending} onEdit={requestEdit} onRemove={showRemoval ? startRemoval : undefined} />
      {removingEmployee && <section className={styles.feedback} aria-labelledby={removalTitle}>
        <h3 ref={removalHeading} id={removalTitle} tabIndex={-1} className={styles.sectionTitle}>Remover {removingEmployee.name} da proposta?</h3>
        <p>As atribuições editáveis da proposta atual serão removidas. As revisões anteriores ficam no histórico. A próxima importação completa da equipe pode incluir o colaborador novamente.</p>
        {editor.dirty && editing?.id === removingEmployee.id && <p>A edição ainda não aplicada deste cadastro também será descartada se a remoção for confirmada.</p>}
        {protectedRemoval && <p className={styles.muted}>{onRemoveEmployee
          ? "A remoção está indisponível porque há bloqueios, afastamentos, feriados ou dias sem indicação explícita de edição."
          : "A remoção está indisponível porque há dias bloqueados."}</p>}
        {removalStatus === "failed" && <p role="alert" className={styles.errorText}>A remoção não foi confirmada. Confira a orientação do planejamento antes de tentar novamente.</p>}
        {removalPending && <p role="status" className={styles.muted}>Confirmando a remoção…</p>}
        <div className={styles.actions}>
          <button type="button" className={buttonClass} disabled={!canManage || protectedRemoval || removalPending} onClick={() => void confirmRemoval()}>Confirmar remoção da proposta</button>
          <button type="button" className={buttonClass} disabled={removalPending} onClick={cancelRemoval}>Manter colaborador</button>
        </div>
      </section>}
      <EmployeeDraftDialog editor={editor} fallbackFocus={() => searchInput.current?.focus()} />
      {editing && (
        <fieldset disabled={!canManage}>
          <EmployeeEditor
            key={editing.id}
            employee={editing}
            input={input}
            managedTeam={managedTeam}
            onDirtyChange={reportDirty}
            onCancel={() => requestEdit(null)}
            onSave={(employee) => {
              if (!canManage) return;
              onChange({
                ...input,
                employees: administrative
                  ? [...input.employees.filter((item) => item.id !== employee.id), employee]
                  : input.employees.map((item) => item.id === employee.id ? employee : item),
              });
              finishEditing();
            }}
          />
        </fieldset>
      )}
    </section>
  );
}
