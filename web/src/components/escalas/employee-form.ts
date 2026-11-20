import { escalaEmployeeSchema } from "@/lib/escalas/schema";
import { currentLeadership } from "@/lib/escalas/leadership";
import type { EscalaEmployee } from "@/lib/escalas/types";

/** Keep server schema rules and editor-only required fields in one submission path. */
export function validateEmployeeForm(draft: EscalaEmployee, team: EscalaEmployee[]) {
  const errors: Record<string, string> = {};
  const result = escalaEmployeeSchema.safeParse({ ...draft, leadership: currentLeadership(draft) });
  if (!result.success) for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] ??= issue.message;
  }
  for (const [field, label] of [["registration", "a matrícula"], ["name", "o nome"], ["sector", "o setor"], ["role", "o cargo"]] as const) {
    if (!draft[field].trim()) errors[field] = `Informe ${label}.`;
  }
  if (team.some(person => person.id !== draft.id && person.registration.trim() === draft.registration.trim()))
    errors.registration = "Essa matrícula já está cadastrada nesta filial.";
  if (draft.planningEnabled !== false && draft.scheduleMode !== "UNTIMED" && draft.scheduleMode !== "MISSING" && !draft.shiftIds.length)
    errors.shiftIds = "Escolha ao menos um turno autorizado para quem tem horário informado.";
  return { employee: result.success && !Object.keys(errors).length ? result.data : null, errors };
}
