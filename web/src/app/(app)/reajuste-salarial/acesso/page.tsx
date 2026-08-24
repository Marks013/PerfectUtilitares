import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ReajusteSalarialAccessForm } from "@/components/reajuste-salarial/reajuste-salarial-access-form";
import { getReajusteModuleSession } from "@/lib/reajuste-salarial/access-session";

export const metadata: Metadata = {
  title: "Acesso ao reajuste salarial",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function safeNextPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/reajuste-salarial") &&
    !candidate.startsWith("/reajuste-salarial/acesso")
    ? candidate
    : "/reajuste-salarial";
}

export default async function ReajusteSalarialAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const nextPath = safeNextPath((await searchParams).next);
  if (await getReajusteModuleSession()) redirect(nextPath);
  return <ReajusteSalarialAccessForm nextPath={nextPath} />;
}
