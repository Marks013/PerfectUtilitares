import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UnimedAccessForm } from "@/components/unimed/unimed-access-form";
import { getUnimedModuleSession } from "@/lib/unimed/module-session";

export const metadata: Metadata = {
  title: "Acesso Unimed",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function safeNextPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/unimed") && !candidate.startsWith("/unimed/acesso")
    ? candidate
    : "/unimed";
}

export default async function UnimedAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const nextPath = safeNextPath((await searchParams).next);
  if (await getUnimedModuleSession()) redirect(nextPath);
  return <UnimedAccessForm nextPath={nextPath} />;
}
