const unimedMoneyFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function normalizeDecimalInput(value: string) {
  return value.replace(/[^\d,.-]/g, "");
}

export function parsePtBrDecimal(value: string) {
  const normalized = normalizeDecimalInput(value).trim();
  if (!normalized) return Number.NaN;

  const hasComma = normalized.includes(",");
  const dotCount = (normalized.match(/\./g) ?? []).length;
  let decimal = normalized;

  if (hasComma) {
    decimal = normalized.replace(/\./g, "").replace(",", ".");
  } else if (dotCount > 1) {
    decimal = normalized.replace(/\./g, "");
  } else if (dotCount === 1) {
    const decimalPlaces = normalized.length - normalized.lastIndexOf(".") - 1;
    if (decimalPlaces > 2) decimal = normalized.replace(".", "");
  }

  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function formatPtBrDecimal(value: string | number) {
  const parsed =
    typeof value === "number" ? value : parsePtBrDecimal(String(value));
  return Number.isFinite(parsed) ? unimedMoneyFormatter.format(parsed) : "";
}

export function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

type ErrorResponse = {
  error?: {
    message?: string;
    details?: unknown;
  };
};

export function errorMessagesFromBody(
  body: ErrorResponse | null,
  fallback: string,
) {
  const messages: string[] = [];
  if (body?.error?.message) messages.push(body.error.message);

  const details = body?.error?.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (
        detail &&
        typeof detail === "object" &&
        "message" in detail &&
        typeof detail.message === "string"
      ) {
        messages.push(detail.message);
      }
    }
  }

  return [...new Set(messages.length > 0 ? messages : [fallback])];
}
