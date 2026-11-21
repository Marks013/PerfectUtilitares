# Execução isolada dos testes de Escalas

Entrega de fontes `AUX-E2E-HARNESS-INTEGRATION r1`, despacho `AUX-E2E-HARNESS-INTEGRATION:r1:batch304`, gate304/reserva305. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`. Esta entrega não executa nem autoriza a execução integrada.

## Contrato corrigido antes da implementação

1. Usar a fixture entregue pelo Chat05, sem criar outro provisionador.
2. Separar as fases geral e nominal em ciclos sequenciais completos, cada qual com banco, processos, captura de e-mail, portas, segredos, temporário e evidências próprios.
3. Semear somente `principal` nas duas fases. Depois do seed, somente a aplicação, o worker e os testes da fase nominal recebem um slug novo e igual em `DEFAULT_TENANT_SLUG` e `E2E_EXCLUSIVE_SCOPED_TENANT_SLUG`. O teste cria essa empresa e suas contas pelas APIs reais e exige 201.
4. Compartilhar uma lista nominal, preservar filtros suportados, exigir um worker e falhar para seleção vazia ou duplicada. Tentar todas as etapas de limpeza mesmo após falha parcial.
5. Verificar funções puras, sintaxe, lint, tipos e listagem protegida, sem provisionar ou iniciar serviços.

O item 3 substitui a proposta de semear a empresa nominal do plano anterior `escalas-e2e-harness-plan.md`. A fonte entregue em `escalas-e2e-updated.md` tem SHA-256 `522dcc92173a7ea922498c3da919a006fa1f61d9172b67516965619bdc87c68b`.

## Fluxo implementado

`web/scripts/e2e-suite-plan.mjs` concentra as funções puras. A única lista de execução nominal contém `escalas-scoped-access.spec.ts`; a fase geral exclui essa mesma lista. `playwright.config.ts` usa essa seleção e mantém `fullyParallel: false` e `workers: 1`. O caso nominal continua sem retries e agora exige a fase nominal.

O runner valida argumentos e coleta as duas fases antes de reservar recursos. O mesmo seletor de arquivo/linha, grep e projeto chega à coleta e à execução. Uma fase sem casos é omitida; a união vazia ou duplicada causa erro. `--pass-with-no-tests` é usado internamente apenas na coleta das fases individuais; a opção não é aceita do chamador nem encaminhada à execução. `--list` termina depois da coleta, sem passar pela preparação dos serviços.

Cada fase selecionada conclui seu ciclo e sua limpeza antes de iniciar a seguinte. Uma falha de execução ou limpeza impede avançar. O banco recebe nome exato novo; credenciais administrativas e segredos são gerados por fase. `ADMIN_EMAIL` e `ADMIN_PASSWORD` são explícitos e iguais no seed, aplicação, worker e Playwright daquela fase. Os aliases herdados `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` são removidos, respeitando a precedência real do seed e o login de `admin-session.ts`. A fase seguinte não recebe o ambiente mutado da anterior.

As duas fases habilitam `E2E_OWNED_ACCOUNT_PROVISIONING=1` no contexto descartável controlado: os cenários gerais de importação/catálogo também criam contas próprias. Ambas reutilizam a captura local já existente no runner, seus parâmetros de e-mail e `E2E_MUTATION=1`. A fixture original permanece intacta. Ela cria empresas/convites/contas por API; não existe seed adicional da empresa nominal nem configuração nova de Escalas no produto.

Os resultados de uma execução futura ficam em `outputs/escalas-e2e-harness/<identificador>/<fase>/`: `selection.json`, `report.json`, `test-results/` e `lifecycle.json`. O resumo de ciclo registra falha de execução e de limpeza sem copiar credenciais. As opções que desviariam configuração, reporter, saída, shard, seleção persistida, repetição ou paralelismo são recusadas. São suportados os seletores posicionais, `--grep`/`-g`, `--grep-invert`, `--project`, `--timeout`, `--global-timeout`, `--max-failures`, `-x`, `--headed`, `--quiet`, `--forbid-only` e `--list`. Overrides explícitos só aceitam worker 1, repetição 1 e retries 0.

A limpeza opera nos IDs de containers, processos, banco, heartbeat, diretórios e arquivos capturados pela própria fase. Cada recurso recebe sua tentativa mesmo se outro falhar; falhas são reportadas e mantêm saída de erro. O código restaura os arquivos de configuração que o Next modifica, como no fluxo anterior. Falhas de spawn entram no caminho de espera/limpeza. Encerramento forçado do sistema ou SIGKILL não pode garantir execução de `finally`; a execução integrada deve continuar sob supervisão e reserva próprias.

## Verificação desta entrega

- Seis testes puros aprovados: partição, seed/runtime e credenciais, filtros focados, rejeição de overrides, seleção vazia/duplicada e limpeza após falhas simuladas. Não fazem chamadas externas.
- `node --check` aprovado nos três arquivos `.mjs`.
- Biome aprovado nos cinco arquivos alterados, sem erros ou avisos; oito sugestões informativas do runner anterior permanecem. A configuração de verificação inclui E2E/scripts sem alterar o Biome do projeto.
- TypeScript instalado, `--noEmit`, sem geração Prisma: aprovado para configuração Playwright e spec nominal, com fechamento estático de imports.
- Listagem protegida com a configuração Playwright real: 36 casos gerais + 1 nominal, preservando os 37 casos de Escalas. Filtro nominal: 0 + 1; filtro de substituição: 8 + 0; grep inexistente: 0 + 0, rejeitado pelo planejador. Nenhum caso/hook foi executado. A guarda bloqueou rede, abertura de servidor, subprocessos, Prisma e leitura de `.env`; zero tentativas registradas.

As evidências finais estão em `outputs/escalas-e2e-harness/checks.json`, `protected-list.json`, logs e `manifest.json`. A revisão de fontes posterior às edições foi feita separadamente da elaboração do plano: conferir lista única, ordem seed/boot, opções da CLI, escopo de cada recurso e continuidade da limpeza. Não foi uma revisão independente por outro agente.

## Pendências para execução real

É obrigatória a escolha e reserva externa de um host PostgreSQL **não produtivo**, além da autorização e disponibilidade dos demais recursos Linux. Nome aleatório, slug, URL local, CI ou opt-in não provam autorização do host. A descoberta de PostgreSQL existente no runner foi preservada; esta entrega não a transforma em verificador de autorização e não seleciona outro host.

Não foram executados o runner isolado, E2E funcional, aplicação, APIs, convites, captura de e-mail, seed, PostgreSQL, Solver, Docker, instalação, Prisma generate, quality, build, publicação ou implantação. A listagem não prova autenticação, migrações, entrega de bytes, rate limiting, descarte real do banco nem encerramento real dos containers. Essas verificações ficam para a execução integrada autorizada e para a revisão independente seguinte. Nenhuma dependência, contrato de produto, rota, schema, seed, pacote ou lockfile foi alterado nesta entrega.
