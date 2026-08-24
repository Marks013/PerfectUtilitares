import { z } from "zod";
import { SalaryAdjustmentError } from "./errors";
import { MAX_FILE_BYTES, MAX_UNIQUE_EMPLOYEES } from "./limits";
import { MAX_SALARY_REVISION_RULES } from "./salary-revision-rules";
import type { SalaryRevisionRule } from "./salary-revision-types";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const MAX_RULES_JSON_BYTES = 512 * 1024;

const centsSchema = z.string().regex(/^(0|[1-9]\d*)$/).max(24);
const ruleSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    minimumSalaryCents: centsSchema,
    maximumSalaryCents: centsSchema,
    newSalaryCents: centsSchema,
    selectedRegistrations: z
      .array(z.string().regex(/^\d+$/).max(32))
      .min(1)
      .max(MAX_UNIQUE_EMPLOYEES),
  })
  .strict();
const rulesSchema = z.array(ruleSchema).max(MAX_SALARY_REVISION_RULES);

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value
  );
}

export function validateSalaryRevisionFile(value: FormDataEntryValue | null) {
  if (!isUploadedFile(value)) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      "Envie um arquivo FPRE131 em formato .xlsx.",
    );
  }
  const validMime = !value.type || value.type === XLSX_MIME;
  if (
    !value.name.toLowerCase().endsWith(".xlsx") ||
    !validMime ||
    value.size === 0
  ) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_WORKBOOK_INVALID",
      `${value.name || "Arquivo"} não é um XLSX válido.`,
    );
  }
  if (value.size > MAX_FILE_BYTES) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_ROW_LIMIT_EXCEEDED",
      `${value.name} ultrapassa o limite de 10 MB.`,
      [],
      413,
    );
  }
  return value;
}

export function parseSalaryRevisionRules(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    throw new SalaryAdjustmentError(
      "REAJUSTE_RULE_INVALID",
      "As regras especiais não foram enviadas corretamente.",
    );
  }
  if (Buffer.byteLength(value, "utf8") > MAX_RULES_JSON_BYTES) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_ROW_LIMIT_EXCEEDED",
      "As regras especiais ultrapassam o limite permitido.",
      [],
      413,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SalaryAdjustmentError(
      "REAJUSTE_RULE_INVALID",
      "As regras especiais possuem JSON inválido.",
    );
  }
  const result = rulesSchema.safeParse(parsed);
  if (!result.success) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_RULE_INVALID",
      "Revise nomes, faixas, novo salário e colaboradores das regras especiais.",
    );
  }
  return result.data.map(
    (rule): SalaryRevisionRule => ({
      ...rule,
      minimumSalaryCents: BigInt(rule.minimumSalaryCents),
      maximumSalaryCents: BigInt(rule.maximumSalaryCents),
      newSalaryCents: BigInt(rule.newSalaryCents),
    }),
  );
}
