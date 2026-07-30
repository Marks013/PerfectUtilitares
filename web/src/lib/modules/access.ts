import { auth, type AppSession } from "@/auth";

export async function getOptionalPageSession() {
  const session = (await auth()) as AppSession | null;
  return session?.user.status !== "ACTIVE" ? null : session;
}
