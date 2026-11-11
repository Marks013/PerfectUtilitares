import type { EscalaEmployee } from "./types";

/** Operational text inference is not a legal classification or permission to cover another sector. */
export function inferLeadership(person: Pick<EscalaEmployee, "role" | "sector">): EscalaEmployee["leadership"] {
  const role = person.role.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
  if (/\bGERENTE\b/.test(role)) return { role: "BRANCH", source: "INFERRED", sectors: [] };
  if (/\bENC(?:\.|\s|$)|\bENCARREGAD/.test(role)) return { role: "SECTOR", source: "INFERRED", sectors: person.sector ? [person.sector] : [] };
  return undefined;
}

/** Explicit manual responsibility wins; text inference follows the employee being edited. */
export function currentLeadership(person: Pick<EscalaEmployee, "role" | "sector" | "leadership">): EscalaEmployee["leadership"] {
  return person.leadership?.source === "MANUAL" ? person.leadership : inferLeadership(person);
}
