import { Mail, MessageCircleQuestion } from "lucide-react";
import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { buildPublicMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPublicMetadata({
  title: "Contato | PerfectUtilitares",
  description:
    "Entre em contato sobre suporte, privacidade, segurança ou sugestões para o PerfectUtilitares.",
  path: "/contato",
});

const contactEmail = process.env.CONTACT_EMAIL ?? "admin@perfectutilitares.com";

export default function ContactPage() {
  return (
    <LegalPage
      eyebrow="Fale conosco"
      title="Contato"
      summary="Use este canal para relatar dificuldades, sugerir melhorias ou encaminhar solicitações relacionadas à sua conta e aos seus dados."
      updatedAt="13 de agosto de 2026"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <section className="app-panel p-5">
          <Mail className="size-5 text-[color:var(--app-teal)]" aria-hidden="true" />
          <h2 className="mt-3">Atendimento por e-mail</h2>
          <p>Inclua uma descrição objetiva e, se necessário, a página onde ocorreu o problema.</p>
          <a className="app-button app-button-primary mt-4 inline-flex" href={`mailto:${contactEmail}`}>
            Enviar e-mail
          </a>
        </section>
        <section className="app-panel p-5">
          <MessageCircleQuestion
            className="size-5 text-[color:var(--app-coral)]"
            aria-hidden="true"
          />
          <h2 className="mt-3">Segurança e privacidade</h2>
          <p>
            Para solicitações sobre dados ou relatos de segurança, use o assunto
            correspondente para facilitar a análise.
          </p>
        </section>
      </div>
    </LegalPage>
  );
}
