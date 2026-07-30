"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { normalizeEmail } from "@/lib/auth/email";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

function getSafeCallbackUrl(value: FormDataEntryValue | null) {
  const callbackUrl = String(value ?? "");
  return callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
    ? callbackUrl
    : "/dashboard";
}

function loginErrorUrl(code: string, callbackUrl: string) {
  const params = new URLSearchParams({ error: code });
  if (callbackUrl !== "/dashboard") {
    params.set("callbackUrl", callbackUrl);
  }
  return `/login?${params.toString()}`;
}

export async function loginAction(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const callbackUrl = getSafeCallbackUrl(formData.get("callbackUrl"));

  if (!email && !password) {
    redirect(loginErrorUrl("missing", callbackUrl));
  }

  if (!email || !email.includes("@")) {
    redirect(loginErrorUrl("email", callbackUrl));
  }

  if (!password) {
    redirect(loginErrorUrl("password", callbackUrl));
  }

  const headerStore = await headers();
  const clientIp = getClientIp(headerStore);
  const loginLimit = checkRateLimit(`login:${clientIp}:${email || "empty"}`, {
    limit: 8,
    windowMs: 15 * 60_000,
  });

  if (loginLimit.limited) {
    redirect(loginErrorUrl("rate", callbackUrl));
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    redirect(callbackUrl);
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(loginErrorUrl("credentials", callbackUrl));
    }

    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/dashboard" });
}
