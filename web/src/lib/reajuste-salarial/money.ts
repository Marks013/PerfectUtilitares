import { SalaryAdjustmentError } from "./errors";

const DECIMAL_PERCENTAGE = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;
const BRAZILIAN_MONEY = /^(?:0|[1-9]\d{0,2}(?:\.\d{3})*|[1-9]\d*)(?:,(\d{1,2}))?$/;

export function parsePercentageBasisPoints(value: string) {
  const normalized = value.trim();
  const match = DECIMAL_PERCENTAGE.exec(normalized);
  if (!match) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_PERCENTAGE_INVALID",
      "Informe um percentual entre 0,01% e 100,00%, com no máximo duas casas decimais.",
    );
  }
  const whole = BigInt(match[1]);
  const decimals = BigInt((match[2] ?? "").padEnd(2, "0"));
  const basisPoints = whole * 100n + decimals;
  if (basisPoints < 1n || basisPoints > 10_000n) {
    throw new SalaryAdjustmentError(
      "REAJUSTE_PERCENTAGE_INVALID",
      "Informe um percentual entre 0,01% e 100,00%.",
    );
  }
  return basisPoints;
}

export function parseMoneyCents(value: unknown): bigint {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return invalidMoney();
    const cents = Math.round(value * 100);
    if (Math.abs(value * 100 - cents) > 1e-6) return invalidMoney();
    return BigInt(cents);
  }
  if (typeof value !== "string") return invalidMoney();
  const normalized = value.trim().replace(/\u00a0/g, "").replace(/\s+/g, "");
  const match = BRAZILIAN_MONEY.exec(normalized);
  if (!match) return invalidMoney();
  const whole = normalized.split(",")[0].replaceAll(".", "");
  const decimals = (match[1] ?? "").padEnd(2, "0");
  return BigInt(whole) * 100n + BigInt(decimals);
}

function invalidMoney(): never {
  throw new SalaryAdjustmentError(
    "REAJUSTE_STRUCTURE_INVALID",
    "Foi encontrada uma base salarial vazia ou inválida.",
  );
}

export function calculateAdjustmentCents(
  baseCents: bigint,
  percentageBasisPoints: bigint,
) {
  const denominator = 10_000n;
  return (baseCents * percentageBasisPoints + denominator / 2n) / denominator;
}

export function formatCents(value: bigint) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = (absolute / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimals = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}R$ ${whole},${decimals}`;
}

export function formatPercentage(basisPoints: bigint) {
  const whole = basisPoints / 100n;
  const decimals = (basisPoints % 100n).toString().padStart(2, "0");
  return `${whole.toString()},${decimals}%`;
}
