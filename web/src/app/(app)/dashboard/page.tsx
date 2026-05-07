import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ScanFace,
  Scissors,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { auth } from "@/auth";

const moduleCards = [
  {
    href: "/fotos",
    accessKey: "canAccessFotos",
    eyebrow: "Editor de Fotos",
    title: "Fotos 3x4 prontas para usar",
    description:
      "Corte, ajuste, padronize e exporte retratos com uma area de trabalho mais direta.",
    cta: "Abrir editor",
    tone: "photo",
    icon: ScanFace,
    details: [
      { icon: Scissors, label: "Recorte guiado" },
      { icon: Sparkles, label: "Ajustes visuais" },
    ],
  },
  {
    href: "/jornada/validar",
    accessKey: "canAccessJornada",
    eyebrow: "Validador de jornada",
    title: "Valide horarios sem rodeio",
    description:
      "Cole a jornada, confira regras e receba o retorno operacional no modulo certo.",
    cta: "Validar jornada",
    tone: "journey",
    icon: Clock3,
    details: [
      { icon: CheckCircle2, label: "Resposta imediata" },
      { icon: ShieldCheck, label: "Regras ativas" },
    ],
  },
] as const;

export default async function DashboardPage() {
  const session = await auth();
  const canUseAllModules = session?.user.role === "ADMIN";

  const visibleCards = moduleCards.filter((card) => {
    if (canUseAllModules) return true;
    return Boolean(session?.user[card.accessKey]);
  });

  return (
    <div className="dashboard-home">
      <section className="dashboard-hero">
        <div>
          <p className="dashboard-kicker">Central de utilitarios</p>
          <h1>Escolha o modulo e va direto ao trabalho.</h1>
        </div>
        <p>
          A antiga visao operacional saiu de cena. Agora a entrada principal
          prioriza as duas tarefas que realmente importam no dia a dia.
        </p>
      </section>

      <section className="module-grid" aria-label="Modulos principais">
        {visibleCards.map((card) => {
          const Icon = card.icon;

          return (
            <Link
              key={card.href}
              href={card.href}
              className="module-card"
              data-tone={card.tone}
            >
              <span className="module-card__shine" aria-hidden="true" />
              <span className="module-card__topline">
                <span className="module-card__icon">
                  <Icon className="size-7" aria-hidden="true" />
                </span>
                <span className="module-card__eyebrow">{card.eyebrow}</span>
              </span>
              <span className="module-card__content">
                <span className="module-card__title">{card.title}</span>
                <span className="module-card__description">
                  {card.description}
                </span>
              </span>
              <span className="module-card__details">
                {card.details.map((detail) => {
                  const DetailIcon = detail.icon;
                  return (
                    <span key={detail.label}>
                      <DetailIcon className="size-4" aria-hidden="true" />
                      {detail.label}
                    </span>
                  );
                })}
              </span>
              <span className="module-card__cta">
                {card.cta}
                <ArrowRight className="size-5" aria-hidden="true" />
              </span>
            </Link>
          );
        })}
      </section>

      {visibleCards.length === 0 ? (
        <section className="empty-access-panel">
          <h2>Nenhum modulo liberado ainda</h2>
          <p>
            Sua conta esta ativa, mas ainda nao possui acesso ao Editor de
            Fotos ou ao Validador de jornada.
          </p>
        </section>
      ) : null}
    </div>
  );
}
