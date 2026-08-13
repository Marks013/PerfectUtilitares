import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { buildPublicMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPublicMetadata({
  title: "Termos de Uso | PerfectUtilitares",
  description:
    "Condições para o uso responsável das ferramentas públicas e das contas do PerfectUtilitares.",
  path: "/termos",
});

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Uso responsável"
      title="Termos de Uso"
      summary="Ao utilizar o PerfectUtilitares, você concorda em empregar as ferramentas de forma lícita, segura e compatível com a finalidade apresentada em cada módulo."
      updatedAt="13 de agosto de 2026"
    >
      <h2>Finalidade do serviço</h2>
      <p>
        O PerfectUtilitares oferece recursos de apoio para jornadas, fotos,
        documentos PDF e módulos administrativos autorizados. As ferramentas
        auxiliam tarefas, mas não substituem conferência humana, orientação
        jurídica, contábil ou profissional quando necessária.
      </p>

      <h2>Responsabilidade do usuário</h2>
      <ul>
        <li>Enviar somente arquivos e dados que esteja autorizado a utilizar.</li>
        <li>Conferir resultados antes de empregá-los em processos oficiais.</li>
        <li>Proteger credenciais e não compartilhar acessos individuais.</li>
        <li>Não tentar contornar limites, acessar terceiros ou prejudicar o serviço.</li>
      </ul>

      <h2>Disponibilidade e resultados</h2>
      <p>
        Trabalhamos para manter o serviço estável e resultados coerentes. Ainda
        assim, manutenções, indisponibilidades externas, características do
        arquivo original ou falhas imprevisíveis podem afetar uma operação. A
        cópia original deve ser preservada até a conferência do resultado.
      </p>

      <h2>Contas e limites</h2>
      <p>
        Operações públicas podem possuir limites de segurança. Contas podem ser
        bloqueadas ou encerradas em caso de abuso, risco à infraestrutura,
        violação destes termos ou obrigação aplicável.
      </p>

      <h2>Alterações</h2>
      <p>
        Estes termos podem ser atualizados para acompanhar mudanças do serviço ou
        requisitos aplicáveis. A data da versão vigente permanece indicada no
        início da página.
      </p>
    </LegalPage>
  );
}
