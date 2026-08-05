import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Files,
  Grip,
  HeartPulse,
  ScanFace,
  Scissors,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const moduleCards = [
  {
    href: "/fotos",
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
    href: "/pdf",
    eyebrow: "Ferramentas PDF",
    title: "Organize documentos com precisão",
    description:
      "Reordene páginas, combine arquivos e prepare documentos em uma área de trabalho visual.",
    cta: "Abrir ferramentas",
    tone: "pdf",
    icon: Files,
    details: [
      { icon: Grip, label: "Organização visual" },
      { icon: ShieldCheck, label: "Processamento protegido" },
    ],
  },
  {
    href: "/jornada/validar",
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

const unimedCard = {
  href: "/unimed",
  eyebrow: "Gestão Unimed",
  title: "Calcule exclusões sem depender do Excel",
  description:
    "Consulte beneficiários, calcule valores e prepare documentos com regras centralizadas.",
  cta: "Abrir Unimed",
  tone: "journey",
  icon: HeartPulse,
  details: [
    { icon: CheckCircle2, label: "Cálculo em centavos" },
    { icon: ShieldCheck, label: "Acesso controlado" },
  ],
} as const;

export default async function DashboardPage() {
  const session = await auth();
  const activeSession = session?.user.status !== "ACTIVE" ? null : session;
  const unimedGrant =
    activeSession?.user.tenantId && activeSession.user.role !== "ADMIN"
      ? await prisma.unimedUserAccess.findFirst({
          where: {
            userId: activeSession.user.id,
            tenantId: activeSession.user.tenantId,
            active: true,
          },
          select: { id: true },
        })
      : null;
  const canSeeUnimed =
    activeSession?.user.role === "ADMIN" || Boolean(unimedGrant);
  const visibleModuleCards = canSeeUnimed
    ? [...moduleCards, unimedCard]
    : moduleCards;

  return (
    <div className="dashboard-home">
      <section className="dashboard-hero">
        <div>
          <p className="dashboard-kicker">Central de utilitarios</p>
          <h1>Escolha o modulo e va direto ao trabalho.</h1>
        </div>
        <p>
          Jornada, Fotos 3x4 e PDF estão disponíveis sem cadastro. Entre apenas
          quando quiser manter seu histórico de validações.
        </p>
      </section>

      <section className="module-grid" aria-label="Modulos principais">
        {visibleModuleCards.map((card) => {
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

      {!activeSession ? (
        <section className="empty-access-panel">
          <h2>Quer guardar suas validações?</h2>
          <p>
            Entre na sua conta para consultar e exportar o histórico de
            Jornadas. As ferramentas continuam públicas mesmo sem login.
          </p>
          <Link href="/login" className="empty-access-panel__action">
            Entrar na conta
          </Link>
        </section>
      ) : null}
    </div>
  );
}
