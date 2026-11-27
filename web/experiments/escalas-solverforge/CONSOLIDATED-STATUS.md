# SolverForge — runtime migrado, qualificação para main bloqueada

Atualização: 27/11/2026.
Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base funcional anterior: `5732c4e21d793a0e22149907cd3e78e563a1ed05`.

## Runtime desta branch

`web/ops/escalas/solver.py` chama exclusivamente o executável SolverForge por `--service`. O Python restante atende transporte HTTP, autenticação, validação estrutural, prazos, cancelamento e supervisão do processo. Não existe fallback para OR-Tools/CP-SAT no serviço.

O Dockerfile compila o upstream SolverForge fixado em `78889c3ff9fda158c70e6a1f67f8c7f0fdae922e`, com Rust 1.100.0 e o Cargo.lock existente. O estágio final copia somente o executável e os módulos de transporte necessários. Compose e os builds da CI usam o contexto `web/`. Foram retirados a implementação CP-SAT, módulos de otimização antigos e o requirements.txt científico do runtime. Não foi executado build Docker nem deploy nesta rodada.

O OR-Tools congelado permanece exclusivamente como controle externo dos benchmarks, construído a partir da revisão histórica. Ele não é instalado pelo novo Dockerfile de runtime. O comparador do produto, suas fixtures e os critérios de não inferioridade não foram alterados. A limpeza e a migração dos contratos não são declaradas completas.

## Correções implementadas na continuação

A admissão nativa de serviço reconhece os padrões do contrato legado sem reescrever o payload: semana iniciada na segunda-feira quando omitida, regras de folgas v1 quando omitidas, modo TIMED quando omitido e calendário MANUAL quando omitido. Valores explícitos malformados continuam rejeitados. Semanas de segunda-feira e domingo mantêm os dias civis corretos. Restrições de sábado v2/v3 não são impostas silenciosamente a uma entrada v1. A filial numérica 02 tem o fechamento dominical v3 aplicado sem inventar feriados.

Duas respostas indevidamente viáveis foram reproduzidas na suíte pública e corrigidas: jornada acima de oito horas sem a autorização de compensação exigida pelo contrato configurado, e uma folga fixa na fronteira que dependia de um feriado futuro no qual a folga não era permitida. As asserções públicas originais de ambos os casos passaram depois da correção.

Domínios pessoais exatos vazios podem produzir INFEASIBLE. Isso só ocorre após enumeração semanal completa ou enumeração completa de um produto pequeno de semanas, limitado a 384 combinações. Uma busca amostrada sem resultado continua UNKNOWN; não se afirma inviabilidade matemática por falta de uma amostra.

Foram acrescentados sete testes Rust e um teste de sucesso HTTP real. Restauraram-se decoradores estáticos e classes auxiliares perdidos na extração anterior dos testes. Uma chamada de calendário em teste usa o auxiliar neutro original. Foram conferidas por AST 104 expressões de asserção preservadas nos três arquivos de testes ajustados. O teste de identidade com carga de 42h passou a fornecer autorização explícita de compensação; as asserções de identidade e imutabilidade foram mantidas. O teste HTTP de contrato não suportado mantém a resposta 422 usando uma política realmente não implementada, e o novo teste separado exige sucesso para o contrato legado agora admitido.

## Verificação local do código publicado

Ambiente: laboratório Linux x86_64/gnu isolado, Rust 1.100.0. Não é a qualificação ARM64/musl nem o ambiente de produção.

| Verificação | Resultado |
|---|---|
| Testes Rust release completos | 100 aprovados; zero falhas, ignorados ou filtrados |
| Testes Python do experimento | 45 aprovados |
| Contratos de processo, transporte e HTTP real | 47 aprovados |
| Clippy all-targets com -D warnings | Aprovado |
| Build release | Aprovado |
| Ruff de ops/escalas | Aprovado |
| Cargo.lock e git diff --check | Aprovados |
| Suíte pública completa, sem filtro | 227 testes; 17 falhas e 89 erros; zero ignorados |

O processo de verificação completo terminou com código 1 por causa da suíte pública. Os 47 testes de fronteira também fazem parte da suíte maior; não devem ser somados como cobertura independente. Os 40 arquivos da árvore de fontes Rust foram comparados byte a byte com a cópia compilada. O binário final foi o mesmo usado nos testes públicos.

Na suíte completa restam 70 erros de entrada não suportada, 12 erros por ausência dos metadados optimization esperados e outros erros de compatibilidade ou auxiliares da implementação anterior. Treze asserções ainda esperam INFEASIBLE onde a busca retorna UNKNOWN. Há também contratos de rotação, controle cooperativo antigo e a verificação de prontidão reprovados. Nenhum desses resultados foi transformado em aprovação.

## Contratos preservados e impedimentos à promoção

`ops/escalas/migration-test-inventory.json` conserva 481 registros históricos: 126 testes retidos na preparação e 355 contratos ainda sujeitos a portabilidade ou revisão explícita de aposentadoria. A origem imutável de cada arquivo é registrada. Esses 355 contratos não são considerados redundantes automaticamente: `test_migration_readiness.py` reprova enquanto houver pendências. Os arquivos de testes ligados ao mecanismo removido não foram usados para alegar equivalência funcional.

Continuam necessárias a cobertura de políticas/calendários e funcionalidades ainda não admitidas, a equivalência de diagnóstico e metadados, a recuperação temporal por cargo/faixa, vigência parcial e dezembro, e os déficits dominicais residuais. Não foi executada nova comparação ampliada ou de 32 repetições para esta migração. Ganhos anteriores não certificam este runtime.

## CI e preservação

O workflow ARM64 existente agora também dispara para alterações nesta branch e executa os contratos HTTP e a suíte pública completa, além da compilação, Clippy, lock e auditoria já existentes. Mantém permissions contents: read e preservação de artefatos. O workflow temporário usado apenas para transferir objetos Git conferidos por hash foi removido da árvore final; seu sucesso não constitui qualificação.

Esta publicação é um checkpoint de desenvolvimento solicitado, não uma aprovação para main. Não houve merge, deploy, alteração na main, no Timefold #74 ou na branch original do PR #75. A mudança de referência foi feita sem forçar nem reescrever o histórico.

## Evidência

Árvore de fontes e configuração executada antes desta atualização documental: `d13b9b5ae5db7484220fc3a11c19a904ff50ba06`.
SHA-256 dos logs locais:

- Rust: `32d91e9063d12d1b545c6742f873026ce4d8a76c4b989732460dd12a2d8d0f11`.
- Clippy: `2953ceba66bd00433726bfc34d1b443e56083773ab88c15049123dfd0a3cc578`.
- Build: `bf50fe235ef24b8d1d891b290c7f7b0efa9630642549aee8b2c96f6df3d52ec9`.
- Fronteira HTTP/processo: `01e3f38eb5051f34795258fe3870e99749444ad369b2e597cbdc0c9fd8132f0b`.
- Suíte completa: `4270c7424c2d485a3ef88a3de63eabc544f837f4fa643a849ee7bc4ef10d7a1e`.
