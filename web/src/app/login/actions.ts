"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { normalizeEmail } from "@/lib/auth/email";

function getSafeCallbackUrl(value: FormDataEntryValue | null) {
  const callbackUrl = String(value ?? "");
  return callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
    ? callbackUrl
    : "/dashboard";
}

function loginErrorUrl(error: string, callbackUrl: string, code?: string) {
  const params = new URLSearchParams({ error });
  if (code) params.set("code", code);
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

  if (!email?.includes("@")) {
    redirect(loginErrorUrl("email", callbackUrl));
  }

  if (!password) {
    redirect(loginErrorUrl("password", callbackUrl));
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    redirect(callbackUrl);
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code.startsWith("rate-")) {
      redirect(loginErrorUrl("CredentialsSignin", callbackUrl, error.code));
    }
    if (error instanceof AuthError) {
      redirect(loginErrorUrl("credentials", callbackUrl));
    }

    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/dashboard" });
}
