import type { EscalaEmployee, EscalaFixedRestSlot } from "./types";

export type FixedRestSlots = [EscalaFixedRestSlot, EscalaFixedRestSlot];

/** Display legacy choices without converting a repeated roster into a setting. */
export function fixedRestSlots(person: Pick<EscalaEmployee, "fixedRestSlots" | "fixedOffDays">): FixedRestSlots {
  if (person.fixedRestSlots) return person.fixedRestSlots.map(slot => ({ ...slot })) as FixedRestSlots;
  return [0, 1].map(index => ({ enabled: person.fixedOffDays[index] !== undefined,
    weekday: person.fixedOffDays[index] ?? null })) as FixedRestSlots;
}

export function fixedRestProjection(slots: FixedRestSlots): Pick<EscalaEmployee, "offMode" | "fixedOffDays"> {
  if (!Array.isArray(slots) || slots.length !== 2) throw new Error("Cadastre exatamente dois controles de folga.");
  for (const slot of slots) {
    if (!slot || typeof slot !== "object" || typeof slot.enabled !== "boolean"
      || slot.weekday !== null && (!Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6)
      || slot.enabled && slot.weekday === null) throw new Error("Escolha um dia válido antes de habilitar a folga fixa.");
  }
  const fixedOffDays = slots.filter(slot => slot.enabled).map(slot => slot.weekday as number).sort((a, b) => a - b);
  if (new Set(fixedOffDays).size !== fixedOffDays.length) throw new Error("As duas folgas fixas habilitadas precisam ter dias diferentes.");
  return { offMode: fixedOffDays.length === 2 ? "FIXED" : fixedOffDays.length === 1 ? "MIXED" : "VARIABLE", fixedOffDays };
}

/** Called only by an explicit user edit. Generation never writes or enables slots. */
export function withFixedRestSlots(person: EscalaEmployee, slots: FixedRestSlots): EscalaEmployee {
  return { ...person, ...fixedRestProjection(slots), fixedRestSlots: slots.map(slot => ({ ...slot })) as FixedRestSlots };
}

export function fixedRestConfigurationError(person: Pick<EscalaEmployee, "offMode" | "fixedOffDays" | "fixedRestSlots">): string | undefined {
  if (person.fixedRestSlots === undefined) return undefined;
  try {
    const expected = fixedRestProjection(person.fixedRestSlots);
    if (person.offMode !== expected.offMode
      || JSON.stringify([...person.fixedOffDays].sort((a, b) => a - b)) !== JSON.stringify(expected.fixedOffDays)) {
      return "Os dias habilitados não correspondem à modalidade de folgas. Revise os dois controles e salve novamente.";
    }
  } catch (error) {
    return error instanceof Error ? error.message : "Configuração de folgas inválida.";
  }
  return undefined;
}
