import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { buildPublicMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPublicMetadata({
  title: "Política de Privacidade | PerfectUtilitares",
  description:
    "Saiba quais dados o PerfectUtilitares utiliza, por que são necessários e como são protegidos.",
  path: "/privacidade",
});

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Transparência"
      title="Política de Privacidade"
      summary="Esta política explica o tratamento de dados no PerfectUtilitares. O princípio aplicado é simples: coletar somente o necessário para entregar, proteger e melhorar cada ferramenta."
      updatedAt="13 de agosto de 2026"
    >
      <h2>Dados utilizados</h2>
      <p>
        No acesso público, são usados registros técnicos de segurança, limites de
        operação e métricas agregadas de desempenho. Em contas cadastradas,
        também são tratados nome, e-mail, organização, permissões e histórico das
        funcionalidades que oferecem esse benefício.
      </p>

      <h2>Arquivos e informações enviados</h2>
      <p>
        Fotos e documentos PDF são usados para executar a operação solicitada.
        Arquivos temporários são removidos conforme o ciclo de processamento e
        não são utilizados para publicidade. O módulo de PDF não mantém histórico
        permanente dos documentos processados.
      </p>

      <h2>Finalidades</h2>
      <ul>
        <li>Entregar as ferramentas e resultados solicitados.</li>
        <li>Proteger contas, APIs e infraestrutura contra abuso.</li>
        <li>Manter históricos quando essa função estiver disponível e ativa.</li>
        <li>Diagnosticar falhas e medir estabilidade e velocidade das páginas.</li>
        <li>Enviar convites, recuperação de acesso e comunicações solicitadas.</li>
      </ul>

      <h2>Serviços auxiliares</h2>
      <p>
        O sistema pode utilizar fornecedores de e-mail, monitoramento de erros e
        métricas de pesquisa. Esses serviços recebem apenas os dados necessários
        à finalidade contratada e são configurados para reduzir a exposição de
        informações pessoais.
      </p>

      <h2>Segurança e retenção</h2>
      <p>
        São aplicados controle de acesso, validação de requisições, limitação de
        uso, comunicação criptografada e registros de auditoria. Os dados são
        mantidos pelo período necessário à operação, à segurança e ao cumprimento
        de obrigações aplicáveis.
      </p>

      <h2>Seus direitos</h2>
      <p>
        Você pode solicitar confirmação, acesso, correção ou exclusão de dados,
        observadas as hipóteses legais de conservação. Usuários autenticados
        também podem excluir a própria conta pela área de conta.
      </p>

      <h2>Contato</h2>
      <p>
        Dúvidas e solicitações sobre privacidade podem ser enviadas pelos canais
        indicados na página de contato.
      </p>
    </LegalPage>
  );
}
