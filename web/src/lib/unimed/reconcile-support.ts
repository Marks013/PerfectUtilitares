import type { ParsedAddress } from "@/lib/unimed/importer";
import type { AddressFields } from "./reconcile-types";

export function key(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function isFuneralAddonDescription(value: string | null | undefined) {
  const description = key(value);
  return (
    description.includes("ADITIVO") ||
    description.includes("FUNERAL") ||
    description.includes("ACESSORIO")
  );
}

function nonEmpty<T>(primary: T | null, fallback: T | null) {
  return primary ?? fallback;
}

export function mergeAddress(
  current: AddressFields,
  imported: ParsedAddress | undefined,
): AddressFields {
  if (!imported) return current;
  return {
    addressLine: nonEmpty(imported.addressLine, current.addressLine),
    number: nonEmpty(imported.number, current.number),
    complement: current.complement,
    district: nonEmpty(imported.district, current.district),
    postalCode: nonEmpty(imported.postalCode, current.postalCode),
    city: nonEmpty(imported.city, current.city),
    state: nonEmpty(imported.state, current.state),
    pis: nonEmpty(imported.pis, current.pis),
  };
}

export function uniqueMap<T>(
  items: T[],
  getKey: (item: T) => string | null | undefined,
) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const normalized = key(getKey(item));
    if (!normalized) continue;
    grouped.set(normalized, [...(grouped.get(normalized) ?? []), item]);
  }
  return new Map(
    [...grouped.entries()]
      .filter(([, matches]) => matches.length === 1)
      .map(([normalized, matches]) => [normalized, matches[0]]),
  );
}

