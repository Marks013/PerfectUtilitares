import { z } from "zod";
import { canonicalBranchCode } from "./branch-code";
import { normalizeEscalaOperatorUsername } from "./operator-username";
import { ESCALA_OPERATOR_CAPABILITIES } from "./permissions";

export const ESCALA_OPERATOR_MAX_BRANCH_GRANTS = 256;
const MAX_PERMISSION_VERSION = 2_147_483_647;
const invisibleOrControl = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const visible = (value: string) => !invisibleOrControl.test(value);
const username = z.string().max(256).transform(normalizeEscalaOperatorUsername).pipe(z.string());
const displayName = z.string().max(512).refine(visible)
  .transform(value => value.normalize("NFKC").trim().replace(/\p{Zs}+/gu, " "))
  .refine(value => visible(value) && value.length > 0 && Array.from(value).length <= 120);
const operatorId = z.string().min(1).max(100).regex(/^[\p{L}\p{N}_.:-]+$/u);
const expectedPermissionVersion = z.number().int().min(1).max(MAX_PERMISSION_VERSION);
const branchCode = z.string().max(640).refine(visible).transform(canonicalBranchCode)
  .pipe(z.string().min(1).max(160));
const capabilities = z.array(z.enum(ESCALA_OPERATOR_CAPABILITIES)).max(ESCALA_OPERATOR_CAPABILITIES.length)
  .refine(values => new Set(values).size === values.length)
  .transform(values => ESCALA_OPERATOR_CAPABILITIES.filter(capability => values.includes(capability)));
const branchGrants = z.array(z.strictObject({ branchCode, active: z.boolean(), capabilities }))
  .max(ESCALA_OPERATOR_MAX_BRANCH_GRANTS)
  .superRefine((grants, context) => {
    const seen = new Set<string>();
    grants.forEach((grant, index) => {
      if (seen.has(grant.branchCode)) {
        context.addIssue({ code: "custom", path: [index, "branchCode"], message: "Filial duplicada" });
      }
      seen.add(grant.branchCode);
    });
  });
const profile = { username, displayName, active: z.boolean() };
const target = { operatorId, expectedPermissionVersion };
const commandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("CREATE_OPERATOR"), ...profile, branchGrants }),
  z.strictObject({ action: z.literal("UPDATE_OPERATOR"), ...target, ...profile }),
  z.strictObject({ action: z.literal("REPLACE_BRANCH_GRANTS"), ...target, branchGrants }),
  z.strictObject({ action: z.literal("REVOKE_SESSIONS"), ...target }),
]);

function canonicalCommand(command: z.output<typeof commandSchema>) {
  if ("username" in command) {
    const { username: usernameNormalized, ...fields } = command;
    return { ...fields, usernameNormalized };
  }
  return command;
}

export type EscalaOperatorAdminCommand = ReturnType<typeof canonicalCommand>;
type InputIssue = Readonly<{ path: string; reason: "UNKNOWN_FIELDS" | "INVALID_VALUE" }>;
export type EscalaOperatorAdminInputResult = Readonly<{
  ok: true; command: EscalaOperatorAdminCommand;
}> | Readonly<{
  ok: false; code: "INVALID_OPERATOR_COMMAND"; issues: readonly InputIssue[];
}>;

const invalid = (path: string): EscalaOperatorAdminInputResult => ({
  ok: false, code: "INVALID_OPERATOR_COMMAND", issues: [{ path, reason: "INVALID_VALUE" }],
});

/**
 * Candidate JSON boundary only: no authorization, database lookup or writes.
 * The future service must resolve the administrator/tenant itself, verify target and branches,
 * compare the expected version, and mutate/audit/revoke atomically before reporting success.
 * No default grants, role, tenant, policy mode or server-owned version can be supplied here.
 */
export function parseEscalaOperatorAdminCommand(input: unknown): EscalaOperatorAdminInputResult {
  // Reject oversized collections before Zod traverses their entries. HTTP byte limits remain required.
  if (typeof input !== "object" || input === null || Array.isArray(input)) return invalid("");
  if ("branchGrants" in input && Array.isArray(input.branchGrants)) {
    if (input.branchGrants.length > ESCALA_OPERATOR_MAX_BRANCH_GRANTS) return invalid("branchGrants");
    for (const [index, grant] of input.branchGrants.entries()) {
      if (typeof grant === "object" && grant !== null && "capabilities" in grant
        && Array.isArray(grant.capabilities) && grant.capabilities.length > ESCALA_OPERATOR_CAPABILITIES.length) {
        return invalid(`branchGrants.${index}.capabilities`);
      }
    }
  }
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) return {
    ok: false,
    code: "INVALID_OPERATOR_COMMAND",
    // Never return the rejected values or unknown property names to logs/UI.
    issues: parsed.error.issues.slice(0, 12).map(issue => ({
      path: issue.path.join("."), reason: issue.code === "unrecognized_keys" ? "UNKNOWN_FIELDS" : "INVALID_VALUE",
    })),
  };
  return { ok: true, command: canonicalCommand(parsed.data) };
}
