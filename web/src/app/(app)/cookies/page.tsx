import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { buildPublicMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPublicMetadata({
  title: "Política de Cookies | PerfectUtilitares",
  description:
    "Entenda os cookies e armazenamentos locais usados para autenticação, segurança e preferências no PerfectUtilitares.",
  path: "/cookies",
});

export default function CookiesPage() {
  return (
    <LegalPage
      eyebrow="Preferências e acesso"
      title="Política de Cookies"
      summary="O PerfectUtilitares usa recursos essenciais para manter sessões seguras e lembrar escolhas do navegador. Não utilizamos cookies de publicidade."
      updatedAt="13 de agosto de 2026"
    >
      <h2>O que são cookies</h2>
      <p>
        Cookies são pequenos registros armazenados pelo navegador. Tecnologias
        semelhantes, como armazenamento local, também podem guardar preferências
        sem identificar diretamente uma pessoa.
      </p>

      <h2>Recursos essenciais</h2>
      <ul>
        <li>Cookies de sessão para autenticar e proteger contas.</li>
        <li>Controles de segurança usados durante navegação e formulários.</li>
        <li>Preferência de tema claro ou escuro mantida no navegador.</li>
        <li>Preferências operacionais escolhidas nas ferramentas.</li>
      </ul>

      <h2>Medição de desempenho</h2>
      <p>
        Métricas técnicas de carregamento e estabilidade podem ser enviadas sem
        nome, e-mail, IP armazenado ou conteúdo dos arquivos. Elas servem para
        identificar páginas lentas e melhorar a experiência real de uso.
      </p>

      <h2>Publicidade</h2>
      <p>
        O site não usa cookies para criar perfis de publicidade comportamental.
        Caso essa prática mude, esta página e os controles de consentimento serão
        atualizados antes da ativação.
      </p>

      <h2>Como controlar</h2>
      <p>
        O navegador permite apagar ou bloquear cookies. O bloqueio dos cookies
        essenciais pode impedir login, manutenção da sessão e outras funções
        protegidas, mas as ferramentas públicas permanecem disponíveis sempre que
        tecnicamente possível.
      </p>
    </LegalPage>
  );
}
