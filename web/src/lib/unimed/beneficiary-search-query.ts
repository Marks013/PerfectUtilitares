export function isValidUnimedBeneficiaryQuery(query: string): boolean {
  const normalizedQuery = query.trim();
  return normalizedQuery.length >= 2 || /^\d$/.test(normalizedQuery);
}
