/** One identity for numeric store codes, without changing textual/alfanumeric codes. */
export function canonicalBranchCode(value: string): string {
  const code = value.trim();
  return /^\d+$/.test(code) ? code.replace(/^0+(?=\d)/, "").padStart(2, "0") : code;
}
