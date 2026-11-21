/** Shared by the future administrator form and username entry. This is not authentication. */
export const ESCALA_OPERATOR_USERNAME_MAX_LENGTH = 64;
const MAX_RAW_LENGTH = 256;
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;

/** Returns a tenant-local lookup key, never a role, grant, tenant or display name. */
export function normalizeEscalaOperatorUsername(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_RAW_LENGTH || INVISIBLE_OR_CONTROL.test(value)) return null;
  const normalized = value.normalize("NFKC").trim().replace(/\p{Zs}+/gu, " ").toLowerCase().normalize("NFKC");
  if (!normalized || INVISIBLE_OR_CONTROL.test(normalized)
    || Array.from(normalized).length > ESCALA_OPERATOR_USERNAME_MAX_LENGTH) return null;
  return normalized;
}
