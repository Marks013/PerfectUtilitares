import type { EscalaInput, EscalaIssue } from "./types";
import { addDays } from "./dates";
import { CCT_UNTIL, SUPERMARKET_CCT } from "./labor-rules";

/** Documentary evidence describes a reference, never permission to use the planning tool. */
const documentaryCodes = new Set([
  "POLICY_PENDING", "POLICY_VALIDITY", "CCT_VALIDITY", "TRANSITION_WEEK_PENDING",
  "COLLECTIVE_AGREEMENT_REQUIRED", "HOLIDAY_WORK", "CCT_SUNDAY_CERTIFICATE",
  "CCT_HOLIDAY_CERTIFICATE", "CCT_NIGHT_CERTIFICATE", "MIXED_42_SIMULATION", "NIGHT_RULE_PENDING",
]);

export function referenceNotices(issues: EscalaIssue[]): EscalaIssue[] {
  const seen = new Set<string>();
  return issues.flatMap(issue => {
    if (!documentaryCodes.has(issue.code)) return [issue];
    // Do not repeat the same documentary reminder for every employee/day.
    if (seen.has(issue.code)) return [];
    seen.add(issue.code);
    return [{ ...issue, severity: "WARNING" as const,
      message: issue.code === "MIXED_42_SIMULATION"
        ? "Jornada mista escolhida: três dias de 8h e dois de 9h, com 3h de intervalo nos dias longos. A publicação é interna e não certifica conformidade."
        : issue.code === "POLICY_PENDING" || issue.code === "POLICY_VALIDITY" || issue.code === "CCT_VALIDITY"
          ? "A referência normativa está ausente, incompleta ou fora da vigência. Você pode planejar e publicar internamente; isso não confirma autorização nem conformidade."
          : "Há uma referência documental a conferir para este cenário. Ela não bloqueia o planejamento ou a publicação interna e não altera as regras configuradas." }];
  });
}

/** Advance reference reminder follows the planned period, not the machine clock. */
export function referenceExpiryNotice(input: Pick<EscalaInput, "policy" | "startDate" | "endDate">): EscalaIssue[] {
  if (input.policy.normativeProfile !== SUPERMARKET_CCT || input.endDate > CCT_UNTIL
    || input.startDate > CCT_UNTIL || input.endDate < addDays(CCT_UNTIL, -30)) return [];
  return [{ code: "CCT_EXPIRING", severity: "WARNING",
    message: `A referência cadastrada termina em ${CCT_UNTIL.split("-").reverse().join("/")}. O planejamento e a publicação interna continuam disponíveis, sem confirmação automática de autorização.` }];
}
