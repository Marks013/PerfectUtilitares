import { headers } from "next/headers";
import { getToken } from "next-auth/jwt";
import { jsonError, requireSession } from "@/lib/api/security";
import { siteSessionSecret } from "@/lib/auth/site-session-secret";

async function hasCurrentSiteCookie() {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie");
  if (!cookie) return false;

  // Match Auth.js's session-cookie namespace using the same public URL/protocol.
  const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  const protocol = authUrl
    ? new URL(authUrl).protocol
    : requestHeaders.get("x-forwarded-proto") ?? "https";
  const account = await getToken({
    // Only a genuine site cookie is evidence. Do not consider Authorization headers.
    req: { headers: new Headers({ cookie }) },
    secureCookie: protocol === "https" || protocol === "https:",
    secret: siteSessionSecret,
  });
  return typeof account?.id === "string" && account.id.length > 0;
}

export async function requireEscalaAccountSession() {
  const account = await requireSession();
  if (!account.ok && account.response.status === 401 && await hasCurrentSiteCookie()) {
    return {
      ok: false as const,
      response: jsonError(
        403,
        "ESCALA_ACCOUNT_REAUTH_REQUIRED",
        "A sessão da conta do site não é mais válida. Entre novamente na conta ou encerre a sessão do site.",
      ),
    };
  }
  return account;
}
