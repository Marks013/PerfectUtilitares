import Link from "next/link";
import { Calculator, Settings2, Upload } from "lucide-react";
import { UnimedAccessLogoutButton } from "@/components/unimed/unimed-access-logout-button";

type UnimedModuleNavProps = {
  showManagement?: boolean;
  accessRole?: "STANDARD" | "ADMIN";
};

const baseClass =
  "inline-flex min-h-10 items-center gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] px-4 py-2 text-sm font-bold text-[color:var(--app-fg)] transition hover:border-[color:var(--app-teal)] hover:text-[color:var(--app-teal)]";

export function UnimedModuleNav({
  showManagement = false,
  accessRole,
}: UnimedModuleNavProps) {
  return (
    <nav
      aria-label="Áreas do módulo Unimed"
      className="mb-5 flex flex-wrap gap-2"
    >
      <Link href="/unimed" className={baseClass}>
        <Calculator className="size-4" aria-hidden="true" />
        Cálculo
      </Link>
      {showManagement ? (
        <>
          <Link href="/unimed/importar" className={baseClass}>
            <Upload className="size-4" aria-hidden="true" />
            Importar bases
          </Link>
          <Link href="/unimed/configuracoes" className={baseClass}>
            <Settings2 className="size-4" aria-hidden="true" />
            Configurações
          </Link>
        </>
      ) : null}
      <span className="ml-auto inline-flex items-center gap-2 text-xs font-bold text-[color:var(--app-muted)]">
        {accessRole === "ADMIN" ? "Administrador" : "Padrão"}
        <UnimedAccessLogoutButton />
      </span>
    </nav>
  );
}
