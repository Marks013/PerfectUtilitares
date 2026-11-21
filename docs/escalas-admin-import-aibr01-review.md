# Revisão independente do reparo AIBR01

Tarefa `AUX-ADMIN-IMPORT-AIBR01-REVIEW r1`; despacho `AUX-ADMIN-IMPORT-AIBR01-REVIEW:r1:batch257`; gate257/reserva258. Data: 14/11/2026. Checkout exclusivo: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

**Resultado: APPROVED para o candidato delimitado de reparo AIBR01 P1.** O bloqueio de paginação parcial foi implementado na origem, é consumido pelo serviço e não pode ser anulado pela declaração administrativa. Não foi identificado novo achado bloqueante no recorte revisado. Esta decisão não aprova produção, integração global, UI ou comportamento transacional em PostgreSQL.

## Evidência e integridade

As três entradas coincidiram com os hashes fornecidos:

| Entrada | SHA-256 |
|---|---|
| docs/escalas-admin-import-backend-review.md | 252fd09ee7614b3abafbac5da8caf81513390e2e7ec0bd17df47bb9e07483ad3 |
| docs/escalas-admin-import-aibr01-fix.md | 5bbbe4c89c509ceb863df9b5434d8227f1ec35221883c3d3a8afe4f302ff6a72 |
| outputs/escalas-admin-import-aibr01-fix/manifest.json | 04767c88473a0be262b957a4ce5eab3dc06dc91237fd7967b9efc2e88315ae91 |

Foram conferidas 22 entradas do manifesto: seis fontes, contrato congelado, 14 artefatos e documento da correção, sem divergência. Os arquivos `red.log/json`, `proof.log/json`, `tests.log/json`, `lint.log/json` e `types.log/json` foram lidos e relacionados às fontes pelos hashes. Os logs e JSON concordam nos resultados. Não são execuções novas desta revisão.

O contrato r2 de `web/src/lib/escalas/import-sync-contracts.ts` permanece `3474f9a284ed13e1feded265984c0348eba3543a94b94684c6c11b0666ca78bc`. O plano mantém o SHA `22b9b0474aeddccf277b4eec34d3485a11aa3f698b00e5e6784bbdb5a9cff0b0` registrado na revisão anterior.

## AIBR01 P1 — corrigido no candidato

**Causa anterior e reprodução existente:** o parser reconhecia cabeçalhos, mas não verificava a sequência. Os casos de primeira página 2 e salto 1→3 eram aceitos com `canApply=true`; APPLY retornava 200, avançava a revisão simulada para 2 e gravava workspace/revisão/auditoria. A confirmação administrativa e o digest apenas repetiam o resultado incompleto. Essa reprodução consta de `red.json` e `red.log`, com duas regressões falhando antes do reparo.

**Correção e contraprovas:**

- `web/src/lib/escalas/fpre136.ts:39-54` mantém contador independente por empresa. Cada empresa começa em 1 e avança exatamente uma página; página inicial maior, salto, repetição, ordem inversa e cabeçalho inválido deixam problema estruturado. Um problema anterior permanece na lista mesmo que páginas posteriores voltem à sequência.
- `fpre136.ts:48` normaliza apenas o código da empresa para comparar representações como `0001` e `1`. O contador não é global: uma empresa distinta pode começar em 1; o retorno a uma empresa já vista continua seu contador. Isso é exercitado por `fpre136.test.ts:20-23`.
- `fpre136.ts:58-65` associa filial/setor e horário à empresa da página. A próxima página da mesma empresa pode continuar o contexto. Uma pessoa sob empresa diferente sem contexto demonstrado produz `PAGE_CONTEXT`. A checagem precede o filtro da filial em `fpre136.ts:68`, evitando descartar uma lacuna/contexto desconhecido como se fosse irrelevante ao escopo.
- `web/src/lib/escalas/import.ts:13-15` acrescenta metadado opcional, sem alterar o contrato r2. `web/src/lib/escalas/import-sync.ts:53` converte qualquer problema de paginação/contexto em `SOURCE_PARTIAL` por campo estruturado, sem interpretar texto de mensagens.
- `import-sync.ts:36` acrescenta um bloqueio quando falta confirmação; não remove outros quando a confirmação existe. `import-sync.ts:178` define `canApply` exclusivamente pela ausência de blockers. `import-sync.ts:197-203` recalcula e verifica antes de chamar SAVE; `200` lança 422 para bloqueio. A verificação transacional existente continua em `209-211`.

Asserções e resultados conferidos em `import-sync.test.ts:74-100` e `proof.log/json`:

| Cenário | Prévia | APPLY | Revisão | Escritas workspace/revisão/auditoria |
|---|---|---:|---:|---|
| Início em 2, salto 1→3, repetição, ordem inversa, outra empresa sem contexto | 200; canApply false; SOURCE_PARTIAL | 422 | 1 | 0/0/0 em cada um dos cinco casos |
| Sequência 1→2, empresa distinta reinicia 1, mesma empresa continua contexto | 200; canApply true | 200 | 2 | 1/1/1 em cada um dos três casos |

Nos cinco bloqueios, a confirmação enviada é explicitamente `completeScopeConfirmed:true`; equipe e WORK permanecem iguais e a transação nem é chamada. Nos sucessos, a remoção autorizada é aplicada e a prévia legada continua respondendo 200 sem nova revisão. Os testes chamam POST, parser, autorização de serviço e SAVE reais; sessão, rate limit e persistência são simulados (`import-sync.test.ts:9-18,45-62`). Isso comprova o encadeamento HTTP/serviço no teste, não uma transação de banco real.

## Matrícula, legado e fronteiras

`fpre136.ts:86-89` conserva a matrícula textual, detecta identidade de origem não textual e rejeita duplicata. A normalização da empresa não alcança a matrícula. `import-sync.ts:54` bloqueia identidade não textual; `61-68` usa igualdade textual e exige vínculo inequívoco. As provas preservam `0001` e `0002`; o teste do parser preserva `001`, `002` e `003` apesar da normalização de empresa/página.

O legado continua recebendo linhas válidas e metadados aditivos, sem nova via de persistência: `fpre136.test.ts:14-18,25-48` e `import-sync.test.ts:98-100`. A rota separa comandos substitutivos em `web/src/app/api/escalas/import/route.ts:47-69` da prévia legada em `95-97`. O mapeamento de EscalaError para seu status continua em `web/src/app/api/escalas/http.ts:10-11`.

A comparação com os 14 hashes da revisão anterior identificou exatamente cinco fontes alteradas: `fpre136.ts`, `fpre136.test.ts`, `import.ts`, `import-sync.ts` e `import-sync.test.ts`. Permanecem idênticos: serviço SAVE (`service.ts` e teste), contrato r2 e teste, importação genérica testada, FPHI105 e teste, rota de importação e teste. Também coincidem `http.ts`, `package.json` e o plano. Não há mudança de SAVE nesse conjunto auditado.

O reparo examinado não acrescenta execução de Solver; atua nos metadados do parser e no bloqueio anterior ao SAVE. Não existe hash anterior de todos os arquivos de Solver no manifesto recebido. Portanto esta revisão não certifica ausência global de edições concorrentes nesses arquivos; eles não foram executados nem ampliados como escopo de auditoria. A decisão se vincula somente ao candidato identificado.

## Verificação e limites

As evidências conferidas registram 85 testes aprovados em cinco arquivos, oito provas focais aprovadas, lint de seis arquivos e TypeScript restrito com saída zero. Os hashes das seis fontes no resultado dos testes coincidem com o candidato atual. Não surgiu hipótese nova concreta que justificasse repetir suites já aprovadas; nenhum teste foi executado nesta revisão.

Uma sequência observada completa não prova que o fim do arquivo não foi cortado silenciosamente: o layout reconhecido não oferece total final ou marcador de encerramento. A declaração administrativa continua necessária para essa lacuna de informação, conforme `docs/escalas-admin-import-sync-plan.md:37-39`; ela não sobrepõe parcialidade detectável. Reiniciar em 1 na mesma empresa permanece bloqueado porque o arquivo não distingue inequivocamente nova emissão legítima de repetição/recorte. Esses limites estão declarados no reparo e não constituem regressão demonstrada.

Não houve PostgreSQL, prova real de locks/rollback/concorrência, UI/E2E, leitura ou compilação da montagem ativa, produção, migração, instalação, commit, push, deploy ou contato lateral. Nenhuma fonte do produto foi editada. Aprovação restrita ao fechamento do AIBR01 no candidato; demais gates continuam com seus responsáveis.

Context Mode foi descoberto e validado nesta tarefa: `ctx_execute` para parsing, hashes e análise; `ctx_batch_execute` para coleta/indexação. Não houve fallback nem escrita por Context Mode. Escritas próprias por `apply_patch`, somente neste documento e em `outputs/escalas-admin-import-aibr01-review/`. Nenhum descartável ou processo de fundo próprio foi criado; não há pasta temporária a concluir nem recurso próprio pendente. Leituras da reserva258 liberadas ao entregar.
