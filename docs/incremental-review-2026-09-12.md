# Revisão do PerfectUtilitares — 11 e 12/09/2026

## Escopo e base

Revisão incremental sobre `5625733`, conferido no checkout `/home/ubuntu/PerfectUtilitares` sem alterações pendentes. Foram examinados autenticação, gestão de usuários, processamento e detecção de fotos, fronteiras do cálculo Unimed, dependências e resultados da análise estática de referências. Esta revisão não representa uma prova de ausência de falhas em todo o projeto.

Context-mode passou em diagnóstico, execução e pesquisa. Caveman foi aplicado à comunicação. As suítes antigas não são usadas como critério de aprovação.

## Falhas identificadas

1. **P2 — resultados de fotos obsoletos.** Limpar arquivos ou alterar ajustes durante uma requisição não invalidava sua conclusão. A resposta anterior podia restaurar resultados e iniciar um download inesperado.
2. **P2 — detecção facial obsoleta.** Operações individuais ou em lote podiam aplicar recortes e mensagens após limpar ou restaurar ajustes; o lote podia substituir o mapa de edição por um estado anterior.
3. **P2 — edição de usuário sobrescrita.** O sucesso de um PATCH anterior reabria o formulário fechado ou substituía outro usuário selecionado. A submissão também dependia do usuário capturado pelo callback de mutação, em vez de vincular explicitamente a requisição ao contexto de edição.
4. **P2 — alteração cosmética encerra sessão.** A assinatura de segurança incluía `updatedAt`. Salvar somente o nome alterava essa data e invalidava a sessão quando a interface recarregava.

## Direção das correções

Fotos passam a invalidar operações pendentes quando seu contexto muda, com cancelamento de requisições HTTP e descarte de conclusões antigas. A detecção facial usa a mesma regra de validade temporal, incluindo caminhos de erro e finalização. A edição administrativa captura usuário e contexto antes da validação e preserva o formulário atual quando outra edição já começou.

A revisão de segurança passa a ser independente da atualização cosmética. Alterações de credenciais ou acesso continuam invalidando tokens antigos, inclusive quando o estado de acesso é posteriormente revertido. A publicação dessa migração exige novo login uma única vez; links de recuperação anteriores devem ser solicitados novamente.

## Observações e otimizações opcionais

- **Análise de referências:** cadastrar os pontos de entrada operacionais e os arquivos MediaPipe carregados dinamicamente tornaria o relatório de código morto mais preciso. A ausência de um import estático não justifica excluir esses arquivos. Não foram removidos arquivos apenas porque o Knip os classificou como sem referência.
- **Desempenho Unimed:** medir duração e quantidade de consultas antes de introduzir cache. Preços dependem de empresa e competência; qualquer cache precisa invalidar na publicação das configurações. Não há evidência coletada que justifique alterar fórmulas ou adicionar uma camada de cache agora.
- **Detecção facial:** manter verificação funcional de cancelamento separada de uma avaliação de precisão com imagens representativas. Simular o protocolo do detector valida as corridas, mas não mede a qualidade do reconhecimento.
- **Componentes grandes:** dividir somente quando houver responsabilidades independentes e ganho verificável. Os maiores arquivos encontrados, isoladamente, não justificam outra refatoração ampla.

## Evidências já coletadas

- `npm audit --omit=dev --json --ignore-scripts`: nenhuma vulnerabilidade conhecida reportada para dependências de produção na consulta desta revisão. Isso não substitui revisão de código nem cobre todos os riscos possíveis.
- A hipótese antiga de ausência de invalidação após troca de senha foi refutada: o hash da senha já participa da assinatura de segurança.
- Backup verificado: `/home/ubuntu/perfectutilitares-config/audit-backup-1789157307416`, com dump do banco e imagens anteriores identificadas. Nenhum dado administrativo de produção é usado nos testes.

## Verificação das correções

- Os dez cenários originais de resposta obsoleta foram reproduzidos no navegador antes da alteração: quatro de processamento/ZIP, quatro de detecção facial e dois de edição administrativa. Os mesmos dez passaram após a correção.
- Dois cenários adicionais de usuários passaram: preservar um rascunho alterado durante o PATCH e ignorar um erro tardio depois de selecionar outro usuário. Os dois cenários administrativos anteriores foram repetidos após esse ajuste final e também passaram.
- Sete testes independentes de autenticação passaram em PostgreSQL descartável com o histórico real de migrações. Cobrem atualização do nome, senha, reversões de acesso, concorrência, SQL direto, limpeza por chave estrangeira e recuperação de senha.
- O navegador autenticado confirmou que PATCH de nome mantém a sessão e atualiza o nome retornado pela sessão.
- Os fluxos normais de fotos passaram: seleção, substituição, ajustes individuais, recorte manual, JPEG, download repetido, ZIP, ausência de rosto, preferências e limpeza de objectURLs.
- Gestão administrativa sintética passou em edição, status, empresa, convite, cópia do link, conflito e exclusão, com conferência da interface e do banco.
- Doze combinações de página, largura e tema passaram sem transbordamento horizontal e sem erros JavaScript. Foram verificadas larguras de 375, 1024 e 1440 pixels, temas claro e escuro, menu móvel por Escape e ativação de link por Enter. A tela móvel de fotos também foi inspecionada visualmente.
- TypeScript, lint completo de 618 arquivos, validação do schema Prisma, sintaxe dos runners, Compose e `git diff --check` passaram. O lint revelou condições legadas na navegação e na recuperação de senha, corrigidas sem alterar o contrato das rotas. A revisão não modificou dependências, lockfiles nem regras de aprovação dos testes antigos.

O comando agregado `npm run quality` contém as suítes antigas que o usuário pediu para desconsiderar. Foram usados checks estáticos reais e verificações independentes em seu lugar. O build de produção é reservado para o único rebuild integral de publicação.

## Arquivos principais

- `/home/ubuntu/PerfectUtilitares/web/src/components/use-photo-processing.ts`
- `/home/ubuntu/PerfectUtilitares/web/src/components/use-photo-face-detection.ts`
- `/home/ubuntu/PerfectUtilitares/web/src/components/photo-3x4-workspace.tsx`
- `/home/ubuntu/PerfectUtilitares/web/src/components/use-users-manager.ts`
- `/home/ubuntu/PerfectUtilitares/web/src/components/app-navigation.tsx`
- `/home/ubuntu/PerfectUtilitares/web/src/lib/auth/security-stamp.ts`
- `/home/ubuntu/PerfectUtilitares/web/prisma/migrations/20260911183000_user_security_version/migration.sql`

A assinatura usa um contador mantido por trigger no banco. A migração executa coluna e trigger em uma transação. O desenho segue os recursos documentados de [triggers PostgreSQL](https://www.postgresql.org/docs/17/sql-createtrigger.html) e [SQL personalizado em migrações Prisma](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features). A observação das configurações de fotos usa um evento de efeito para acessar callbacks atuais sem reinstalar o observador a cada renderização, conforme a [documentação React](https://react.dev/reference/react/useEffectEvent).

## Recuperação e limites

Em rollback da aplicação, a coluna e o trigger aditivos podem permanecer. Trocar novamente o formato da assinatura exige novo login e novos links de recuperação. A restauração do banco é reservada ao procedimento explícito de recuperação; não deve ser executada automaticamente para reverter código.

Os testes de corrida facial simulam somente o protocolo do iframe. Não medem precisão do detector com rostos reais. As operações administrativas foram verificadas apenas com dados sintéticos isolados. A publicação deve ser seguida pela conferência de saúde dos serviços e dos fluxos públicos no navegador.
