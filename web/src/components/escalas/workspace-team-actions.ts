import type { EscalaOperationalCommand } from "@/lib/escalas/access-contracts";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { operationalCommand } from "./operational-client";

type Revision = Pick<EscalaWorkspace, "id" | "revision">;
type TeamCommand =
  | Pick<Extract<EscalaOperationalCommand, { action: "ADD_EMPLOYEE" }>, "action" | "regimeModelId" | "name" | "registration">
  | Pick<Extract<EscalaOperationalCommand, { action: "REMOVE_EMPLOYEE" }>, "action" | "employeeId">;
export type AbsenceCommand = { action: "ADD_ABSENCE" | "REMOVE_ABSENCE"; employeeId: string; startDate: string; endDate: string };

export function workspaceTeamActions({ workspaceId, canCreate, canChangeTeam, absenceTarget, run, flushDraft, acceptWorkspace, setNotice }: {
  workspaceId?: string;
  canCreate: boolean;
  canChangeTeam: boolean;
  absenceTarget?: () => Revision | null;
  run: (label: string, operation: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>) => Promise<void>;
  flushDraft: () => Promise<Revision | null>;
  acceptWorkspace: (value: EscalaWorkspace) => void;
  setNotice: (message: string) => void;
}) {
  function createApproved(approvedPolicyVersionId: string) {
    if (!canCreate) return;
    void run("Criando planejamento com a configuração aprovada…", async (signal, isCurrent) => {
      const saved = await operationalCommand({ action: "CREATE_APPROVED", approvedPolicyVersionId }, signal);
      if (!isCurrent()) return;
      acceptWorkspace(saved);
      setNotice(saved.teamSeed === "LATEST_IMPORT"
        ? "Planejamento criado com a equipe da última importação da filial. Confira os colaboradores antes de gerar."
        : "Planejamento criado com a equipe da configuração aprovada. Confira os colaboradores antes de gerar.");
    });
  }

  function createMonth(branchCode: string, month: string) {
    if (!canCreate) return;
    void run("Abrindo o planejamento da filial…", async (signal, isCurrent) => {
      const saved = await operationalCommand({ action: "CREATE_MONTH", branchCode, month }, signal);
      if (!isCurrent()) return;
      acceptWorkspace(saved);
      setNotice(saved.canEdit
        ? "Planejamento aberto com configuração válida. Confira as folgas e os horários herdados antes de gerar."
        : "Planejamento aberto para consulta. Ainda não há configuração válida para gerar ou publicar.");
    });
  }

  async function changeTeam(command: TeamCommand) {
    if (!workspaceId || !canChangeTeam) return false;
    const adding = command.action === "ADD_EMPLOYEE";
    let confirmed = false;
    await run(adding ? "Cadastrando colaborador pelo modelo aprovado…" : "Removendo colaborador do planejamento…", async (signal, isCurrent) => {
      const saved = await flushDraft();
      if (!saved || saved.id !== workspaceId || !isCurrent()) return;
      const result = await operationalCommand({ ...command, id: saved.id, expectedRevision: saved.revision }, signal);
      if (!isCurrent()) return;
      acceptWorkspace(result);
      confirmed = true;
      setNotice(adding ? "Colaborador cadastrado e salvo. Gere uma nova proposta para conferir a escala."
        : "Colaborador removido desta revisão. Confira a equipe e gere outra proposta para atualizar a escala.");
    });
    return confirmed;
  }

  async function changeAbsence(command: AbsenceCommand) {
    const target = absenceTarget?.();
    if (!target) return false;
    const adding = command.action === "ADD_ABSENCE";
    let confirmed = false;
    await run(adding ? "Salvando afastamento…" : "Excluindo afastamento…", async (signal, isCurrent) => {
      const result = await operationalCommand({ ...command, id: target.id, expectedRevision: target.revision }, signal);
      const current = absenceTarget?.();
      if (!isCurrent() || current?.id !== target.id || current.revision !== target.revision) return;
      acceptWorkspace(result);
      confirmed = true;
      setNotice(adding ? "Afastamento salvo. A próxima geração vai considerar o período registrado."
        : "Afastamento excluído. Gere Só folgas ou Folgas e horários para preencher os dias liberados.");
    });
    return confirmed;
  }

  return {
    createApproved,
    createMonth,
    changeAbsence,
    addEmployee: (regimeModelId: string, name: string, registration: string) => changeTeam({ action: "ADD_EMPLOYEE", regimeModelId, name, registration }),
    removeEmployee: (employeeId: string) => changeTeam({ action: "REMOVE_EMPLOYEE", employeeId }),
  };
}
