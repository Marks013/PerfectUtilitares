# Revisão independente do reparo E2ER01

**Resultado: approved para o recorte local. E2ER01/P1 está corrigido nas fontes revisadas.** Não foram identificados novos defeitos neste reparo. A aprovação não comprova E2E funcional, PostgreSQL, descarte efetivo de recursos nem libera produção.

Tarefa `AUX-E2E-E2ER01-REVIEW r1`; despacho `AUX-E2E-E2ER01-REVIEW:r1:batch325`; gate325 `f308a8513eecbc430adfb33220c7c53367344bef349f42fdf9fb2800fef1d7f1`; reserva326. Revisão em 14/11/2026, no checkout `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

## Conclusão por requisito

| Requisito | Evidência | Parecer |
|---|---|---|
| Preservar o aprovador confirmado ou possível | `web/e2e/escalas-access-fixtures.ts:105` registra owner.id antes da chamada APPROVE (`:106`), sem depender do status, JSON ou ID recebido | Fecha o caminho original e os casos de transporte interrompido ou resposta ilegível após commit. Retenção conservadora também quando não se sabe se houve gravação. |
| Desativar sem apagar histórico | `escalas-access-fixtures.ts:130` usa PATCH pelo contexto root com status BLOCKED e exige 200; somente contas não retidas seguem para DELETE (`:131`) | Mantém identidade, FK e aprovações. Não existe fallback para excluir aprovador/tenant nem aceitação indiscriminada de 404. |
| Operação administrativa autorizada e na ordem correta | Root é autenticado por loginAsAdmin (`:43` a `:45`); owner é outra conta criada (`:82`). Bloqueio ocorre depois das operações que usam a sessão do owner (`:117` a `:130`) | Evita SELF_UPDATE_BLOCKED. A rota real exige ADMIN/origem e mantém a proteção do último ADMIN (`web/src/app/api/admin/users/[id]/route.ts:97`, `:116`, `:159`; `web/src/lib/users/account-mutations.ts:87`). A conta root de preparação permanece ativa e não integra identities. |
| Continuar após falhas | Cada operador, política, workspace, aprovação e conta usa attempt; o finally trata cada contexto e depois o root separadamente (`escalas-access-fixtures.ts:111` a `:135`) | Uma rejeição não impede tentar os recursos seguintes. Erro e causa original são guardados; AggregateError é lançado ao final (`:138`). Falha no PATCH não vira exclusão física. |
| Aprovação com ID desconhecido | Somente IDs conhecidos entram em policies e são revogados (`:107`, `:125`) | O reparo não declara revogada uma aprovação cuja resposta se perdeu. Ela e o aprovador bloqueado permanecem até descarte do banco exclusivo. Esse limite está documentado, sem alegação de rollback. |
| Interação com o harness | `web/scripts/run-isolated-e2e.mjs:471` captura a falha do Playwright e entra em finally; `:479` tenta os recursos, incluindo o banco exato em `:488`; `:518` propaga erros de execução/limpeza | A retenção é compatível com o descarte da fase. Se o caso ou cleanup falhar, o harness ainda tenta o descarte; falha do descarte também é erro. Nada disso substitui a prova de execução real. |

O esquema e a operação de revogação mantêm a relação histórica que motivou E2ER01. O reparo adequa a fixture a esse contrato; não altera a FK, trigger, API ou asserções funcionais do cenário nominal.

## Regressão e provas examinadas

`web/scripts/escalas-access-fixtures.test.mjs:10` lê o helper real completo; `:11` transpila em memória e `:129` a `:142` carrega o resultado em VM com imports controlados. A implementação de cleanup não foi copiada para o teste. Os mocks representam autenticação/provisionamento/persistência e a recusa de exclusão do aprovador; não substituem sucesso funcional de um E2E.

Os seis casos cobrem aprovação confirmada (`:150`), resposta perdida/JSON ilegível (`:161`), seis falhas independentes e continuidade de recursos/contextos (`:175`), conta sem tentativa de aprovação removível (`:194`) e falha de bloqueio sem fallback destrutivo (`:200`). O teste de falhas verifica AggregateError, seis erros, causa contendo 404 e tentativa dos demais recursos. A ordem da produção usa root.request.patch; o mock não prova autorização HTTP, por isso a rota real também foi inspecionada estaticamente.

Conferi os logs e `red-green.json`: fonte anterior com 5 falhas/1 sucesso, incluindo `404 !== 200`; fonte corrigida com 6/6 sucessos e zero skips. O SHA da regressão coincide com o informado para ambas as execuções. Os resultados de sintaxe, lint e tipos são aprovados nos artefatos. A listagem protegida contém 16 casos em 6 specs consumidores; apenas listagem, sem hooks/casos executados. Não repeti suites aprovadas: não surgiu hipótese nova que exigisse execução adicional.

## Integridade

Os 18 registros do manifesto do reparo foram conferidos antes e depois: duas fontes, um documento, três entradas e doze evidências, sem divergência. O próprio manifesto também confere com o despacho. Entre os arquivos web já registrados pela revisão anterior, somente o helper mudou; runner, configuração, specs e fontes de produto registrados permaneceram iguais. O novo arquivo de teste é a adição declarada. Essa comparação não é uma auditoria global de arquivos fora do inventário.

| Caminho | SHA-256 |
|---|---|
| web/e2e/escalas-access-fixtures.ts | `cbb5803d2bcd4432d9ea0365fd64bffbe4ef4889f8499ab311f5e2ea9a4b322c` |
| web/scripts/escalas-access-fixtures.test.mjs | `79b9426eb87cfe5e5de497a430985964bf609f4286ed89934b0fbea3731a441d` |
| docs/escalas-e2e-cleanup-fix.md | `c38cb938e7fd6c784238d99c15ecb17390bdf3c8930a8fc5c462a5a375c6d0e2` |
| outputs/escalas-e2e-cleanup-fix/manifest.json | `530156e285d5cbe2b6d5d2cb12a1e480ab9cfc329fc49857d9c27d117c34739a` |

## Limites e liberação

E2ER01 é encerrado quanto à fonte local. Continuam pendentes PATCH/DELETE reais, restrição referencial em PostgreSQL, cenário nominal completo e encerramento/descarte do banco da fase. O cenário de resposta perdida preserva deliberadamente registros desconhecidos até esse descarte. A revisão não promove o teste puro a comprovação de autenticação, FK ou infraestrutura. A escolha humana de aguardar ambiente existente autorizado permanece vigente.

Context Mode efetivo: ctx_batch_execute na coleta, ctx_execute para análise/hashes e ctx_search para timeline, que retornou sem resultados. Sem falha de ferramenta ou fallback. Escrita por apply_patch nativo somente neste relatório e no manifesto de revisão. Nenhuma suite, E2E, browser real, API, serviço, banco, migração, instalação, produção ou Solver foi executado. Nenhum temporário ou processo persistente foi criado; não há pasta a concluir. Produto e trabalho alheio preservados. Recursos da reserva326 liberados ao coordenador.
