import { parseMoneyCents } from "@/lib/reajuste-salarial/money";

export function salaryIncreasePercentage(oldSalary: string, newSalary: string): string | null {
  if (!oldSalary.trim() || !newSalary.trim() || oldSalary.length > 40 || newSalary.length > 40) return null;
  try {
    const oldCents = parseMoneyCents(oldSalary);
    const newCents = parseMoneyCents(newSalary);
    if (oldCents <= 0n) return null;
    const difference = newCents - oldCents;
    const negative = difference < 0n;
    const numerator = (negative ? -difference : difference) * 10_000_000n;
    const units = (numerator + oldCents / 2n) / oldCents;
    return `${negative && units !== 0n ? "-" : ""}${units / 100_000n},${(units % 100_000n).toString().padStart(5, "0")}%`;
  } catch { return null; }
}
