import type { Competency } from "./types";

export type ReportColumn = {
  key: string;
  label: string;
  kind: "branch" | "registration" | "name" | "base" | "adjustment" | "total";
  competencyKey?: string;
  x: number;
  width: number;
};

const BASE_COLUMNS = [
  { key: "branch", label: "Filial", kind: "branch" as const, weight: 1 },
  { key: "registration", label: "Cadastro", kind: "registration" as const, weight: 0.8 },
  { key: "name", label: "Nome do Colaborador", kind: "name" as const, weight: 2.4 },
];

export function allocateReportColumns(
  usableWidth: number,
  competencies: Competency[],
  tableLeft = 0,
) {
  const definitions = [
    ...BASE_COLUMNS,
    ...competencies.flatMap((competency) => [
      {
        key: `base-${competency.key}`,
        label: `BASE\n${competency.key}`,
        kind: "base" as const,
        competencyKey: competency.key,
        weight: 0.9,
      },
      {
        key: `adjustment-${competency.key}`,
        label: `Antecipação\n${competency.key}`,
        kind: "adjustment" as const,
        competencyKey: competency.key,
        weight: 0.9,
      },
    ]),
    { key: "total", label: "Total\nAntecipação", kind: "total" as const, weight: 1 },
  ];
  const totalWeight = definitions.reduce((sum, item) => sum + item.weight, 0);
  let cursor = tableLeft;
  const columns: ReportColumn[] = definitions.map((definition, index) => {
    const width =
      index === definitions.length - 1
        ? tableLeft + usableWidth - cursor
        : (usableWidth * definition.weight) / totalWeight;
    const column = { ...definition, x: cursor, width };
    cursor += width;
    return column;
  });

  if (competencies.length === 4) {
    const invalid = columns.some((column) => {
      if (column.kind === "branch" || column.kind === "total") return column.width < 62;
      if (column.kind === "registration") return column.width < 50;
      if (column.kind === "name") return column.width < 150;
      return column.width < 54;
    });
    if (invalid) {
      throw new Error("A largura útil do PDF não comporta quatro competências com legibilidade.");
    }
  }
  return columns;
}

export function employeeRowHeight(textHeight: number) {
  return Math.max(18, Math.min(32, Math.ceil(textHeight + 6)));
}

export function hasVerticalSpace(
  currentY: number,
  requiredHeight: number,
  contentBottom: number,
) {
  return currentY + requiredHeight <= contentBottom;
}
