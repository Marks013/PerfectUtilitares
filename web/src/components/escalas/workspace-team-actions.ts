import type { EscalaOperationalCommand } from "@/lib/escalas/access-contracts";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { operationalCommand } from "./operational-client";

type Revision = Pick<EscalaWorkspace, "id" | "revision">;
type TeamCommand =
  | Pick<Extract<EscalaOperationalCommand, { action: "ADD_EMPLOYEE" }>, "action" | "regimeModelId" | "name" | "registration">
  | Pick<Extract<EscalaOperationalCommand, { action: "REMOVE_EMPLOYEE" }>, "action" | "employeeId">;

export function workspaceTeamActions({ workspaceId, canCreate, canChangeTeam, run, flushDraft, acceptWorkspace, setNotice }: {
  workspaceId?: string;
  canCreate: boolean;
  canChangeTeam: boolean;
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

  return {
    createApproved,
    addEmployee: (regimeModelId: string, name: string, registration: string) => changeTeam({ action: "ADD_EMPLOYEE", regimeModelId, name, registration }),
    removeEmployee: (employeeId: string) => changeTeam({ action: "REMOVE_EMPLOYEE", employeeId }),
  };
}
