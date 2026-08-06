type BranchRule = {
  code: string;
  aliases: readonly string[];
};

const BRANCH_RULES: readonly BranchRule[] = [
  { code: "MA", aliases: ["MULTI ATACADO"] },
  { code: "AN", aliases: ["ANCHIETA"] },
  { code: "M", aliases: ["MATRIZ"] },
  { code: "I", aliases: ["ICARAIMA"] },
  { code: "S", aliases: ["BIG"] },
  { code: "P", aliases: ["HIPER"] },
  { code: "T", aliases: ["TIRADENTES"] },
  { code: "A", aliases: ["ATACADO"] },
  { code: "C", aliases: ["CASTELO BRANCO", "CASTELO"] },
];

const BRANCH_CODES = new Set(BRANCH_RULES.map((rule) => rule.code));

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function containsWholeAlias(value: string, alias: string) {
  return (
    value === alias ||
    value.startsWith(`${alias} `) ||
    value.endsWith(` ${alias}`) ||
    value.includes(` ${alias} `)
  );
}

export function formatUnimedBranchForPdf(
  value: string | null | undefined,
) {
  if (!value?.trim()) return "—";

  const key = normalized(value);
  if (BRANCH_CODES.has(key)) return key;

  const aliases = BRANCH_RULES.flatMap((rule) =>
    rule.aliases.map((alias) => ({
      alias: normalized(alias),
      code: rule.code,
    })),
  ).sort((left, right) => right.alias.length - left.alias.length);

  for (const entry of aliases) {
    if (containsWholeAlias(key, entry.alias)) return entry.code;
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
