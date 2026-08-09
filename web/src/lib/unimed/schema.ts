import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { DEFAULT_UNIMED_EMAIL_SUBJECT } from "@/lib/unimed/defaults";

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

const moneySchema = z.number().finite().nonnegative().max(99_999_999.99);

const configuredMoneySchema = moneySchema.transform((value) =>
  new Prisma.Decimal(value)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber(),
);

export const unimedCompetencySchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
});

export const unimedEmailRequestSchema = z
  .object({
    beneficiaryId: z.string().trim().min(8).max(64),
    idempotencyKey: z.string().uuid(),
    confirmed: z.literal(true),
  })
  .strict();

export const unimedDocumentRequestSchema = z
  .object({
    beneficiaryId: z.string().trim().min(8).max(64),
    reasonCode: z.number().int().min(1).max(9_999),
    confirmed: z.literal(true),
  })
  .strict();

export const unimedCalculationInputSchema = z
  .object({
    reasonCode: z.number().int().min(1).max(9_999),
    exclusionDate: dateOnlySchema,
    planEnrollmentDate: dateOnlySchema,
    billingClosure: z.enum(["OPEN", "AUTOMATIC_DAY_25"]),
    holder: z.object({
      invoicePlanAmount: moneySchema,
      payrollPlanAmount: moneySchema,
      addonAmount: moneySchema,
    }),
    dependents: z
      .array(
        z.object({
          invoicePlanAmount: moneySchema,
          addonAmount: moneySchema,
        }),
      )
      .max(6),
    nextCompetency: z
      .object({
        holder: z.object({
          invoicePlanAmount: moneySchema,
          payrollPlanAmount: moneySchema,
          addonAmount: moneySchema,
        }),
        dependents: z
          .array(
            z.object({
              invoicePlanAmount: moneySchema,
              addonAmount: moneySchema,
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

export const unimedConfigurationSchema = z
  .object({
    validFrom: dateOnlySchema,
    billingClosure: z.enum(["OPEN", "AUTOMATIC_DAY_25"]),
    annualAdjustmentPercent: z.number().finite().min(0).max(100),
    differencePercent: z.number().finite().min(0).max(100),
    ageBrackets: z
      .array(
        z.object({
          code: z.string().trim().min(1).max(30),
          label: z.string().trim().min(1).max(80),
          minAge: z.number().int().min(0).max(150),
          maxAge: z.number().int().min(0).max(150).nullable(),
          sortOrder: z.number().int().min(0).max(100),
        }),
      )
      .min(1)
      .max(30),
    planPrices: z
      .array(
        z.object({
          planCode: z.string().trim().min(1).max(80),
          ageBracketCode: z.string().trim().min(1).max(30),
          companyAmount: configuredMoneySchema,
          employeeAmount: configuredMoneySchema,
        }),
      )
      .min(1)
      .max(300),
    addonPrices: z
      .array(
        z.object({
          code: z.string().trim().min(1).max(40),
          label: z.string().trim().min(1).max(100),
          amount: configuredMoneySchema,
        }),
      )
      .max(30),
    reasons: z
      .array(
        z.object({
          code: z.number().int().min(1).max(9_999),
          label: z.string().trim().min(2).max(100),
          documentKind: z.enum(["NONE", "RN561", "INACTIVE_TERM"]),
        }),
      )
      .min(1)
      .max(100)
      .optional(),
    email: z.object({
      enabled: z.boolean(),
      recipients: z
        .array(z.string().trim().toLowerCase().email())
        .min(1)
        .max(10),
      subjectTemplate: z.literal(DEFAULT_UNIMED_EMAIL_SUBJECT),
    }),
  })
  .superRefine((input, context) => {
    const bracketCodes = new Set<string>();
    const sortOrders = new Set<number>();
    for (const [index, bracket] of input.ageBrackets.entries()) {
      if (bracketCodes.has(bracket.code)) {
        context.addIssue({
          code: "custom",
          path: ["ageBrackets", index, "code"],
          message: "Código de faixa etária duplicado.",
        });
      }
      if (sortOrders.has(bracket.sortOrder)) {
        context.addIssue({
          code: "custom",
          path: ["ageBrackets", index, "sortOrder"],
          message: "Ordem de faixa etária duplicada.",
        });
      }
      if (bracket.maxAge !== null && bracket.maxAge < bracket.minAge) {
        context.addIssue({
          code: "custom",
          path: ["ageBrackets", index, "maxAge"],
          message: "Idade máxima menor que a idade mínima.",
        });
      }
      bracketCodes.add(bracket.code);
      sortOrders.add(bracket.sortOrder);
    }

    const ordered = [...input.ageBrackets].sort(
      (left, right) => left.minAge - right.minAge,
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous.maxAge === null || current.minAge <= previous.maxAge) {
        context.addIssue({
          code: "custom",
          path: ["ageBrackets"],
          message: "As faixas etárias não podem se sobrepor.",
        });
        break;
      }
    }

    const prices = new Set<string>();
    for (const [index, price] of input.planPrices.entries()) {
      if (!bracketCodes.has(price.ageBracketCode)) {
        context.addIssue({
          code: "custom",
          path: ["planPrices", index, "ageBracketCode"],
          message: "Faixa etária não cadastrada.",
        });
      }
      const uniqueKey = `${price.planCode}|${price.ageBracketCode}`;
      if (prices.has(uniqueKey)) {
        context.addIssue({
          code: "custom",
          path: ["planPrices", index],
          message: "Preço duplicado para plano e faixa etária.",
        });
      }
      prices.add(uniqueKey);
    }

    const reasonCodes = new Set<number>();
    const reasonLabels = new Set<string>();
    for (const [index, reason] of (input.reasons ?? []).entries()) {
      const normalizedLabel = reason.label.toLocaleLowerCase("pt-BR");
      if (reasonCodes.has(reason.code)) {
        context.addIssue({
          code: "custom",
          path: ["reasons", index, "code"],
          message: "Código de motivo duplicado.",
        });
      }
      if (reasonLabels.has(normalizedLabel)) {
        context.addIssue({
          code: "custom",
          path: ["reasons", index, "label"],
          message: "Nome de motivo duplicado.",
        });
      }
      reasonCodes.add(reason.code);
      reasonLabels.add(normalizedLabel);
    }
  });

export function zodIssueDetails(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
