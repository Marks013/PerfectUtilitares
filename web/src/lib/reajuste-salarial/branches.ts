function normalizeComparableText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pt-BR");
}

export function comparePtBr(left: string, right: string) {
  return left.localeCompare(right, "pt-BR", { sensitivity: "base" });
}

const SALARY_BRANCHES = [
  { branchAlias: "Matriz", aliases: ["Matriz"] },
  { branchAlias: "Icaraima", aliases: ["Icaraima"] },
  { branchAlias: "Big", aliases: ["Big"] },
  { branchAlias: "Hiper", aliases: ["Hiper", "Hipermercado"] },
  { branchAlias: "Tiradentes", aliases: ["Tiradentes"] },
  { branchAlias: "Atacado", aliases: ["Atacado"] },
  { branchAlias: "Castelo", aliases: ["Castelo", "Castelo Branco"] },
  { branchAlias: "Multi Atacado", aliases: ["Multi Atacado"] },
  { branchAlias: "Anchieta", aliases: ["Anchieta"] },
] as const;

const BRANCH_BY_NORMALIZED_NAME = new Map(
  SALARY_BRANCHES.flatMap(({ branchAlias, aliases }, index) =>
    aliases.map(
      (alias) =>
        [normalizeComparableText(alias), { branchAlias, index }] as const,
    ),
  ),
);

export function canonicalBranchAlias(value: string) {
  return (
    BRANCH_BY_NORMALIZED_NAME.get(normalizeComparableText(value))?.branchAlias ??
    value.replace(/\s+/g, " ").trim()
  );
}

export function compareBranchAliases(left: string, right: string) {
  const leftOrder = BRANCH_BY_NORMALIZED_NAME.get(
    normalizeComparableText(left),
  )?.index;
  const rightOrder = BRANCH_BY_NORMALIZED_NAME.get(
    normalizeComparableText(right),
  )?.index;
  if (leftOrder !== undefined || rightOrder !== undefined) {
    return (
      (leftOrder ?? Number.MAX_SAFE_INTEGER) -
      (rightOrder ?? Number.MAX_SAFE_INTEGER)
    );
  }
  return comparePtBr(left, right);
}
