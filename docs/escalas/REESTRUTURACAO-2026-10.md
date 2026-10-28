# Reestruturação do assistente Escala 5×2

Estado: implementação e validação concluídas no servidor em 28/10/2026. Commit e implantação autorizados posteriormente pelo usuário, condicionados à conferência de liberação e ao smoke pós-deploy. A autorização não inclui alteração de credenciais nem push.

## Plano e limites

1. Diagnóstico e regressões: conferir importação, carga, mês civil, continuidade e referências privadas.
2. Planejamento: preservar CP-SAT e restrições obrigatórias; equilibrar presença setorial e fins de semana sem exigir folgas consecutivas.
3. Simplificação: filial, mês e carga de referência como fluxo principal; conferência normativa somente contextual, sem certificar juridicamente uma simulação.
4. Interface: grade mensal, busca, filtros, legenda compartilhada, alterações com prévia e desfazer.
5. Relatórios e persistência: PDF e XLSX com modelo único; exclusão transacional com controle de revisão e proteção de dependências publicadas.
6. Verificação: testes focados, motor real e verificador independente, qualidade e build final únicos; documentar limites sem declarar verificações inexistentes.

## Contratos preservados

- O horizonte técnico continua com semanas completas. visibleMonth identifica o mês civil; somente esse mês aparece na grade e apuração mensal.
- MISSING significa horário não informado. UNTIMED continua sendo confirmação explícita. Ambos permitem presença diária sem horas fictícias ou cobertura horária.
- Dados originais importados, histórico, ausências, mínimos confirmados, bloqueios, autenticação e isolamento por empresa/filial permanecem preservados.
- Arquivos pessoais de referência são usados privadamente e não entram em fixtures ou commits.
- Não há migração destrutiva, alteração de segredos ou deploy automático.

## Defeitos confirmados antes das alterações

- A mudança da carga passa duas vezes a referência anterior para planningWeeklyHours.
- Horários zerados importados viram UNTIMED sem confirmação.
- A apresentação usa o horizonte técnico como período mensal.
- A equidade do solver não penaliza toda a equipe sem horário descansar nos mesmos fins de semana.
- O PDF divide por semana e setor/cargo e repete totais individuais; o XLSX principal é uma listagem por dia, não uma grade equivalente.

Os resultados finais de verificação serão registrados ao concluir a revisão integrada.

## Evidências já colhidas em 27–28/10/2026

- Testes adicionados antes das correções reproduziram classificação/meses ausentes, ausência de DELETE e concentração de presença setorial no solver.
- CP-SAT: 61 testes Python e dez cenários de equivalência TypeScript passaram na primeira revisão, incluindo meses de 28/29/30/31 dias e inviabilidades conhecidas. A revisão de fronteira futura acrescenta cenários antes da verificação final.
- Interface: E2E real isolado passou com importação sintética, criação/persistência, grade mensal, prévia de perda de cobertura, edição, desfazer, troca, viewport de 375 px e cancelar/confirmar exclusão. Nenhum registro operacional foi excluído.
- Exportação: 70 testes focados passaram; arquivos PDF/XLSX foram gerados e lidos de volta, comparando células e datas. Cenário sintético com 65 pessoas em três setores passou de 22 para quatro páginas; renderização conferida. Meses de 28–31 dias possuem testes de geometria e equivalência.
- Referência privada FPRE136: 650 pessoas no arquivo, 81 selecionadas na Filial 08, sem erro de importação. Simulação de novembro/2026 a 40h incluiu 75 pessoas, das quais 12 sem horário informado, e preservou seis exceções sem ampliá-las automaticamente. Resultado FEASIBLE em 12,138 s, 3.150 atribuições técnicas e validação independente sem erros obrigatórios. Rascunho PDF de oito páginas, 76.331 bytes; XLSX de 27.569 bytes. Não foram gravadas pessoas, escalas ou exportações privadas no banco ou nas fixtures.
- Esse cenário conserva 249 faltas de cobertura estimada, falta de histórico real e conferência normativa pendente. Não é uma escala publicada, certificação jurídica nem prova de cobertura real suficiente. Nenhuma pessoa sem horário recebeu jornada fictícia.
- Benchmark sintético de quatro líderes: mínimo diário de presença passou de zero para dois e dias com setor vazio de um para zero. Tempo passou de 0,061 s para 0,240 s; o ganho é de qualidade do resultado, não uma aceleração prometida.

## Referências e limites preservados

O webinar privado foi lido como referência técnica, não como instrução do sistema. O art. 7º da EC 141/2026 foi confrontado com o índice oficial do Planalto, que mantém a exigência de instrumento coletivo para a ampliação diária na transição. A abertura integral do portal retornou bloqueio de acesso nesta sessão; não houve certificação de autenticidade ou vigência da CCT privada no Mediador. Fonte oficial: https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm.

- Jornadas curtas/noturnas sem adaptação segura continuam identificadas como exceções; não recebem horas inventadas.
- O prazo finito pode retornar FEASIBLE sem ter alcançado os objetivos inferiores de equidade; não equivale a ótimo.
- Helvetica mantém os acentos usados em português; glifos não suportados são substituídos de forma segura no PDF. Excel preserva Unicode válido.
- A exclusão de versões já publicadas é conservadora quando existem períodos publicados próximos potencialmente dependentes.
- Não foram alterados segredos ou credenciais. A validação inicial terminou sem deploy; a autorização posterior de implantação não altera esse limite.

## Verificação final

Verificação concluída em 28/10/2026, por etapas, sem reduzir gates ou alterar dependências.

- Prisma validate, TypeScript, Biome e testes operacionais passaram na execução inicial de npm run quality. Ela parou em duas expectativas legadas do exportador, que ainda exigiam a lista antiga do Excel e a página de resumo removida do PDF.
- Após atualizar essas asserções para ler o conteúdo real do novo formato, a cobertura consolidada passou: 262 arquivos, 1.904 testes aprovados e três ignorados. As etapas já aprovadas não foram repetidas integralmente.
- Cobertura global atual: linhas 64.4%, statements 62.72%, funções 57.88% e branches 55.1%. O denominador inclui componentes TSX na configuração já existente; nenhum limiar foi reduzido nesta tarefa.
- Biblioteca src/lib/escalas: 98,25% de linhas, 98,25% de funções, 93,68% de statements e 87,21% de branches.
- Knip, gate de tamanho de módulos e gate de rotas passaram. Um export de constante usado apenas internamente foi removido; o valor e o comportamento não mudaram.
- Python final: 68/68 testes; motor CP-SAT versus TypeScript: 21/21 cenários reais equivalentes, incluindo continuidade posterior, meses de 28–31 dias, intervalos, domingos, bloqueios, pessoas sem horário e inviabilidades.
- Build único aprovado: compilação em 51 s e geração das 84 páginas previstas. Não houve rebuild de contêiner nem deploy.
- A suíte E2E em desenvolvimento foi interrompida de forma controlada antes do limite de dez minutos do executor, após expirar o canal Context Mode de 300 s. Não é registrada como aprovada. A limpeza isolada foi verificada.
- A suíte completa pós-build foi executada com E2E_PRODUCTION=1, banco descartável e relatório JSON: 49 aprovados, três ignorados e uma falha em teste antigo de Reajuste, fora de Escalas. Esse teste tentava preencher um select porque não escolhia o cálculo fixo. O fluxo foi corrigido para selecionar o modo e localizar o campo por seu rótulo completo; somente esse cenário foi repetido e passou em 14,3 s. Resultado final: 50 cenários distintos aprovados, três ignorados e zero falhas pendentes. O código da aplicação não mudou após o build.
- O E2E específico de Escalas passou na aplicação compilada, além da rodada isolada anterior de 58,9 s: criação/importação, mês civil, cobertura na prévia, edição, desfazer, troca, persistência, viewport de 375 px e exclusão/cancelamento.
- Compose aprovado com sudo e arquivos protegidos via config --quiet. Aplicação, worker PDF e banco mantiveram saúde e horários de início anteriores; não houve reinício da produção.
- git diff --check aprovado. next-env.d.ts e tsconfig.json foram restaurados pelos ambientes isolados, sem alterações residuais. Nenhum pacote ou segredo foi alterado.

### E2E ignorados, fora do módulo Escalas

- presence event customization, private invitation and report work together
- original June July August payroll produces audited event totals and PDF
- original payroll imports with monthly eligibility and precise hand packer rate

Esses três casos não são considerados verificados; mantêm as condições de ambiente/fixtures da suíte preexistente.

### Entrega e recuperação

Após a validação inicial, o usuário autorizou commit e implantação no servidor. A liberação deve preservar as imagens anteriores para recuperação, validar o Compose com acesso aos arquivos protegidos, publicar a revisão limpa e conferir saúde e navegação após o deploy. O push não está incluído nessa autorização. Não há migração de banco nesta reestruturação: os novos campos de contexto e mês são opcionais no JSON das revisões. Revisões anteriores continuam legíveis pelo código novo; um rollback para leitor antigo estrito deve preservar compatibilidade com esses campos, sem apagar metadados ou revisões.

Os relatórios de execução temporários foram resumidos aqui antes da limpeza. Os testes automatizados e o verificador reproduzível permanecem no repositório.

## Arquivos alterados

- /home/ubuntu/PerfectUtilitares/docs/escalas/OPERACAO.md
- /home/ubuntu/PerfectUtilitares/docs/escalas/REESTRUTURACAO-2026-10.md
- /home/ubuntu/PerfectUtilitares/web/e2e/escalas-maintenance.spec.ts
- /home/ubuntu/PerfectUtilitares/web/e2e/reajuste-import.spec.ts
- /home/ubuntu/PerfectUtilitares/web/ops/escalas/solver.py
- /home/ubuntu/PerfectUtilitares/web/ops/escalas/test_solver.py
- /home/ubuntu/PerfectUtilitares/web/scripts/escalas/verify-model.mjs
- /home/ubuntu/PerfectUtilitares/web/src/app/api/escalas/export/route.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/app/api/escalas/import/route.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/app/api/escalas/route.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/app/api/escalas/route.ts
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/coverage-import.tsx
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/delete-plan.tsx
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/editing-model.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/employees.tsx
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/escalas-workspace.tsx
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/hours-proposal.test.tsx
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/hours-proposal.tsx
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/results.tsx
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/roster-editor.tsx
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/roster-model.ts
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/roster.tsx
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/use-escalas-workspace.ts
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/workspace-model.ts
- /home/ubuntu/PerfectUtilitares/web/src/components/escalas/workspace-view.test.tsx
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/boundary.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/continuity-overlap.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/continuity.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/dates.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/deletion.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/export.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/export.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/fpre136.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/fpre136.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/generation.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/generation.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/monthly.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/order.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/preparation.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/preparation.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/presentation.test.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/presentation.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/schema.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/service.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/types.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/validation-employee.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/validation-time.ts
- /home/ubuntu/PerfectUtilitares/web/src/lib/escalas/validation.ts
