import { NextResponse } from "next/server";
import {
  enforcePersistentRateLimit,
  jsonError,
  methodNotAllowed,
  readJsonBody,
  requireContentType,
  requireMaxContentLength,
  requireSameOrigin,
} from "@/lib/api/security";
import { requireUnimedAccess } from "@/lib/unimed/access.server";
import {
  getUnimedConfiguration,
  getUnimedPriceHistory,
  saveUnimedConfiguration,
  UnimedConfigurationRetentionError,
} from "@/lib/unimed/configuration";
import {
  unimedConfigurationSchema,
  zodIssueDetails,
} from "@/lib/unimed/schema";
import { DEFAULT_UNIMED_EMAIL_SUBJECT } from "@/lib/unimed/defaults";

export const runtime = "nodejs";

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function GET() {
  const access = await requireUnimedAccess("VIEW");
  if (!access.ok) return access.response;

  const priceHistory = await getUnimedPriceHistory(access.tenantId);
  const configuration = await getUnimedConfiguration(
    access.tenantId,
    priceHistory[0]?.validFrom,
  );
  const response = NextResponse.json({
    ageBrackets: configuration.ageBrackets.map((bracket) => ({
      code: bracket.code,
      label: bracket.label,
      minAge: bracket.minAge,
      maxAge: bracket.maxAge,
      sortOrder: bracket.sortOrder,
    })),
    planPrices: configuration.planPrices.map((price) => ({
      id: price.id,
      planCode: price.planCode,
      ageBracketCode: price.ageBracket.code,
      companyAmount: price.companyAmount.toFixed(2),
      employeeAmount: price.employeeAmount.toFixed(2),
      validFrom: isoDate(price.validFrom),
      validTo: price.validTo ? isoDate(price.validTo) : null,
    })),
    addonPrices: configuration.addonPrices.map((price) => ({
      id: price.id,
      code: price.code,
      label: price.label,
      amount: price.amount.toFixed(2),
      validFrom: isoDate(price.validFrom),
      validTo: price.validTo ? isoDate(price.validTo) : null,
    })),
    billing: configuration.billing
      ? {
          closure: configuration.billing.closure,
          closingDay: configuration.billing.closingDay,
          validFrom: isoDate(configuration.billing.validFrom),
          validTo: configuration.billing.validTo
            ? isoDate(configuration.billing.validTo)
            : null,
        }
      : null,
    rules: configuration.rules
      ? {
          annualAdjustmentPercent:
            configuration.rules.annualAdjustment.toNumber() * 100,
          differencePercent: configuration.rules.difference.toNumber() * 100,
          validFrom: isoDate(configuration.rules.validFrom),
          validTo: configuration.rules.validTo
            ? isoDate(configuration.rules.validTo)
            : null,
        }
      : null,
    email: configuration.email
      ? {
          enabled: configuration.email.enabled,
          recipients: configuration.email.recipients,
          subjectTemplate: DEFAULT_UNIMED_EMAIL_SUBJECT,
        }
      : null,
    reasons: configuration.reasons.map((reason) => ({
      code: reason.code,
      label: reason.label,
      documentKind: reason.documentKind,
    })),
    priceHistory: priceHistory.map((period) => ({
      status: period.status,
      validFrom: isoDate(period.validFrom),
      validTo: period.validTo ? isoDate(period.validTo) : null,
      planPrices: period.planPrices.map((price) => ({
        planCode: price.planCode,
        ageBracketCode: price.ageBracket.code,
        ageBracketLabel: price.ageBracket.label,
        minAge: price.ageBracket.minAge,
        maxAge: price.ageBracket.maxAge,
        sortOrder: price.ageBracket.sortOrder,
        companyAmount: price.companyAmount.toFixed(2),
        employeeAmount: price.employeeAmount.toFixed(2),
      })),
      addonPrices: period.addonPrices.map((price) => ({
        code: price.code,
        label: price.label,
        amount: price.amount.toFixed(2),
      })),
    })),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function POST() {
  return methodNotAllowed(["GET", "PUT"]);
}

export async function PUT(request: Request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const access = await requireUnimedAccess("MANAGE_CONFIG");
  if (!access.ok) return access.response;

  const limited = await enforcePersistentRateLimit(request, {
    keyPrefix: "unimed-configuration",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const contentTypeError = requireContentType(request, ["application/json"]);
  if (contentTypeError) return contentTypeError;

  const contentLengthError = requireMaxContentLength(request, 128 * 1024);
  if (contentLengthError) return contentLengthError;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = unimedConfigurationSchema.safeParse(json.data);
  if (!parsed.success) {
    return jsonError(
      400,
      "UNIMED_CONFIGURATION_INVALID",
      "Revise as configurações do módulo Unimed.",
      zodIssueDetails(parsed.error),
    );
  }

  try {
    const saved = await saveUnimedConfiguration(
      access.tenantId,
      { moduleSessionId: access.moduleSessionId },
      parsed.data,
    );
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof UnimedConfigurationRetentionError) {
      return jsonError(
        409,
        "UNIMED_CONFIGURATION_TOO_OLD",
        error.message,
      );
    }
    return jsonError(
      500,
      "UNIMED_CONFIGURATION_FAILED",
      "Não foi possível salvar as configurações. Tente novamente.",
    );
  }
}
