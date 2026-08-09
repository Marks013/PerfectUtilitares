import { z } from "zod";

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export const dateOnlySchema = z
  .string()
  .regex(dateOnlyPattern, "Use uma data no formato AAAA-MM-DD.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Informe uma data válida.");

export const unimedMoneySchema = z
  .number()
  .finite()
  .nonnegative()
  .max(99_999_999.99);

export const unimedCalculationInputSchema = z
  .object({
    reasonCode: z.number().int().min(1).max(9_999),
    exclusionDate: dateOnlySchema,
    planEnrollmentDate: dateOnlySchema,
    billingClosure: z.enum(["OPEN", "AUTOMATIC_DAY_25"]),
    holder: z.object({
      invoicePlanAmount: unimedMoneySchema,
      payrollPlanAmount: unimedMoneySchema,
      addonAmount: unimedMoneySchema,
    }),
    dependents: z
      .array(
        z.object({
          invoicePlanAmount: unimedMoneySchema,
          addonAmount: unimedMoneySchema,
        }),
      )
      .max(6),
    nextCompetency: z
      .object({
        holder: z.object({
          invoicePlanAmount: unimedMoneySchema,
          payrollPlanAmount: unimedMoneySchema,
          addonAmount: unimedMoneySchema,
        }),
        dependents: z
          .array(
            z.object({
              invoicePlanAmount: unimedMoneySchema,
              addonAmount: unimedMoneySchema,
            }),
          )
          .max(6),
      })
      .optional(),
  })
  .refine(
    (input) =>
      !input.nextCompetency ||
      input.nextCompetency.dependents.length === input.dependents.length,
    {
      message:
        "A próxima competência deve conter os mesmos beneficiários selecionados.",
      path: ["nextCompetency", "dependents"],
    },
  )
  .refine((input) => input.planEnrollmentDate <= input.exclusionDate, {
    message: "A inclusão no plano não pode ocorrer após a exclusão.",
    path: ["planEnrollmentDate"],
  });
