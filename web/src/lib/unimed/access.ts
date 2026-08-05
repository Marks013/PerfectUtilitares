import type { UnimedAction, UnimedActor } from "@/lib/unimed/types";

const operatorActions = new Set<UnimedAction>([
  "VIEW",
  "CALCULATE",
  "GENERATE_DOCUMENT",
  "SEND_EMAIL",
]);

const managerActions = new Set<UnimedAction>([
  ...operatorActions,
  "IMPORT",
  "PUBLISH",
  "MANAGE_CONFIG",
]);

export function canUseUnimed(actor: UnimedActor, action: UnimedAction) {
  if (actor.role === "ADMIN") {
    return true;
  }

  if (!actor.accessLevel) {
    return false;
  }

  if (actor.accessLevel === "ADMIN") {
    return true;
  }

  if (actor.accessLevel === "MANAGER") {
    return managerActions.has(action);
  }

  return operatorActions.has(action);
}
