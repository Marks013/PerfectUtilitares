"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { normalizeEmail } from "@/lib/auth/email";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";

export async function loginAction(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");
  const headerStore = await headers();
  const clientIp = getClientIp(headerStore);
  const loginLimit = checkRateLimit(`login:${clientIp}:${email || "empty"}`, {
    limit: 8,
    windowMs: 15 * 60_000,
  });

  if (loginLimit.limited) {
    redirect("/login?error=rate");
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=credentials");
    }

    throw error;
  }
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
