const BRANCH_ALIASES: Record<string, string> = {
  M: "M",
  MATRIZ: "M",
  ICA: "ICA",
  ICARAIMA: "ICA",
  S: "S",
  BIG: "S",
  P: "P",
  HIPER: "P",
  T: "T",
  TIRADENTES: "T",
  A: "A",
  ATACADO: "A",
  C: "C",
  CASTELO: "C",
  MA: "MA",
  "MULTI ATACADO": "MA",
  AN: "AN",
  ANCHIETA: "AN",
};

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function formatUnimedBranchForPdf(
  value: string | null | undefined,
) {
  if (!value?.trim()) return "—";
  const key = normalized(value);
  const direct = BRANCH_ALIASES[key];
  if (direct) return direct;

  const parts = key.split(/\s*[-–—]\s*/).filter(Boolean);
  for (const part of parts) {
    const alias = BRANCH_ALIASES[part];
    if (alias) return alias;
  }
  return value.trim();
}

export function formatUnimedCompetency(value: string) {
  const [year, month] = value.slice(0, 7).split("-");
  return year && month ? `${month}/${year}` : value;
}

export function nextUnimedCompetency(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  if (!year || !month) return "—";
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextMonth).padStart(2, "0")}/${nextYear}`;
}
