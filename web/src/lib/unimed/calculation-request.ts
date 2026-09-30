import { z } from "zod";
import { dateOnlySchema } from "./schema";

export const calculationRequestSchema = z
  .object({
    beneficiaryId: z.string().trim().min(8).max(64),
    dependentIds: z
      .array(z.string().trim().min(8).max(64))
      .max(6)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Não repita dependentes no mesmo cálculo.",
      }),
    manualDependents: z
      .array(
        z
          .object({
            clientId: z.string().trim().min(8).max(64),
            fullName: z.string().trim().min(2).max(160),
            birthDate: dateOnlySchema,
            inclusionDate: dateOnlySchema.optional(),
            hasAddon: z.boolean().default(false),
          })
          .strict(),
      )
      .max(6)
      .refine(
        (dependents) =>
          new Set(dependents.map((dependent) => dependent.clientId)).size ===
          dependents.length,
        { message: "Não repita dependentes manuais no mesmo cálculo." },
      )
      .default([]),
    reasonCode: z.number().int().min(1).max(9_999),
    exclusionDate: dateOnlySchema,
    planEnrollmentDate: dateOnlySchema.optional(),
    billingClosure: z.enum(["OPEN", "AUTOMATIC_DAY_25"]),
  })
  .strict()
  .superRefine((value, context) => {
    const dependentCount =
      value.dependentIds.length + value.manualDependents.length;
    if (dependentCount > 6) {
      context.addIssue({
        code: "custom",
        message: "Use no máximo seis dependentes por cálculo.",
        path: ["manualDependents"],
      });
    }
    if (value.reasonCode === 1 && dependentCount === 0) {
      context.addIssue({
        code: "custom",
        message: "Selecione ao menos um dependente para esta exclusão.",
        path: ["dependentIds"],
      });
    }
    value.manualDependents.forEach((dependent, index) => {
      if (dependent.birthDate > value.exclusionDate) {
        context.addIssue({
          code: "custom",
          message:
            "O nascimento do dependente não pode ocorrer após a exclusão.",
          path: ["manualDependents", index, "birthDate"],
        });
      }
      if (
        dependent.inclusionDate &&
        dependent.inclusionDate > value.exclusionDate
      ) {
        context.addIssue({
          code: "custom",
          message: "A inclusão do dependente não pode ocorrer após a exclusão.",
          path: ["manualDependents", index, "inclusionDate"],
        });
      }
    });
    if (
      value.planEnrollmentDate &&
      value.planEnrollmentDate > value.exclusionDate
    ) {
      context.addIssue({
        code: "custom",
        message: "A inclusão no plano não pode ocorrer após a exclusão.",
        path: ["planEnrollmentDate"],
      });
    }
  });

export type UnimedCalculationRequest = z.output<
  typeof calculationRequestSchema
>;
