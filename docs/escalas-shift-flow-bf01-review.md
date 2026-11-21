# Revisão do reparo BF01

**Resultado: approved. BF01 encerrado no recorte local.** A guarda final agora cobre o manifesto legado, sem alterar DTOs ou a semântica v1/v2. Não foi identificado novo defeito demonstrável no delta. Esta aprovação não equivale a UI montada, banco real ou liberação de produção.

Tarefa `AUX-SHIFT-FLOW-BF01-REVIEW`, revisão 1, despacho `AUX-SHIFT-FLOW-BF01-REVIEW:r1:batch198`, gate198/reserva199. Data: 14/11/2026. Cwd: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

Revisão estática curta. Única escrita: este documento. Sem execução de suítes, aplicação, Prisma, rede, banco, Solver, instalação, migração, alteração de implementação ou mensagens laterais.

## Confronto do delta com o achado

- Em `api/escalas/turnos/export/manifest/route.ts:46–53`, ambos os serviços são aguardados antes de `requireEscalaCapability(actor, "export.integration")`; somente depois é construída a resposta 201. Isso fecha a janela identificada em BF01, inclusive quando o bloqueio/rebaixamento ocorre no retorno do armazenamento.
- O parser/limites, autorização inicial, rate limit e tratamento de erros permanecem. O resultado tipado é devolvido diretamente: não há redução de campos, reinterpretação de omissões ou inclusão de seleção v2 no corpo legado.
- `shift-catalog/export.ts:158–182` mantém o DTO v1: manifestId, expiresAt, mês/ano, rowCount, omissions e TXT1/TXT2. `selection-export.ts:204–214` mantém selectionVersion, context, rows, counts, digest, formatos por modo e suas reautorizações internas. A guarda comum não remove nem substitui a proteção da v2.
- Os serviços e o contrato r2 permanecem nos hashes da entrega anterior. A rota é a única implementação de produto alterada pelo reparo; a regressão funcional foi ampliada, sem relaxar os testes de transporte.

## Prova entregue e seu alcance

`selection-export.test.ts:73–82` chama o POST legado com serviços/autorização reais e persistência simulada. O controle positivo exige 201 e igualdade do DTO completo: uma linha, as duas omissões NO_REFERENCE de pessoas não enviadas e formatos TXT1/TXT2. Também confirma payload interno versão 1. Portanto o reparo não converte o v1 em seleção exata v2 silenciosamente.

Em `:84–99`, o delegate primeiro armazena o manifesto e depois muda o usuário atual para BLOCKED ou OPERATOR. Mantém identidade, empresa e securityVersion 0; não depende de alterar a versão para provocar a negativa. O teste espera 403/JSON, sem manifestId/omissions nem anexo, e confirma que o registro já criado continua presente. Isso comprova a intenção da guarda e distingue negação de resposta de rollback.

A fixture simula autenticação inicial, rate limit e delegates Prisma; não substitui a própria verificação de capacidade nem o serviço legado. Os testes antigos de transporte da rota continuam com mocks próprios e não são apresentados como prova equivalente. Os caminhos v2 permanecem na mesma suíte, incluindo bytes reais TXT1/TXT2, modos, filtros, omissões, bloqueios e revogação.

Logs entregues, **lidos sem reexecução**:

- Antes: dois casos falharam com `expected 201 to be 403`; três aprovações e 20 casos fora da seleção focal.
- Depois: 30 aprovações em três arquivos, sem exclusões; inclui dois autotestes do guard de I/O.
- Lint de três arquivos e tipos delimitados: saída 0. Esses resultados são atribuídos ao executor; esta revisão não os transforma em execução nova.

Nenhuma atomicidade absoluta é prometida depois da última consulta. Manifesto persistido não foi desfeito; a correção impede devolver a prévia a quem perdeu autoridade durante a espera. Persistência real, concorrência PostgreSQL, cookie/autenticação real e UI/E2E permanecem lacunas de integração, não novos defeitos presumidos do reparo.

## Integridade e liberação

As nove fontes/documentos autorizados inventariados permaneceram estáveis entre coleta e conferência. Dos sete registros de sources-after.sha256, seis fontes constam no READ deste despacho e seus hashes conferem abaixo. `catalog.ts` foi conferido pela coordenação; não foi reaberto nesta revisão por estar fora do READ. Não se atribui a esta tarefa uma sétima verificação de fonte não autorizada.

| Fonte | SHA-256 |
| --- | --- |
| Documento do reparo | `a524baeb211ec3937c408842509f4d229e2cbbf3be505b490051af41a4913c55` |
| `turnos/export/manifest/route.ts` | `08e70993e288c3abec60b1c156cf304fcda95c35665860ee8f80b156b9b29d1a` |
| Teste de transporte preservado | `97b6c88a1468e85fce5e8f8ee9d31b394de03132f0dfad9042b68294496b5c01` |
| `selection-export.test.ts` | `ebf2cc2db121266826830d1a1d3613db439cd2dd06e359878e2ca2440c3e0694` |
| Serviço v1 `export.ts` | `151cf1e071f86cc3a96080caf66c48f576525e2e3a3af5805cabe5a2d545a64b` |
| Serviço v2 `selection-export.ts` | `58bdf3d8a0d91001370f0fc8d5baae1a2446319cbeec3126c162c54762385c3c` |
| Contrato r2 `flow-contracts.ts` | `91b42669a4ba865d01c0961ecd936ed6d963d5dc516e9a9d167b7e91bd78babd` |

Context Mode efetivamente usado: ctx_search timeline para continuidade, ctx_batch_execute para coleta delimitada e ctx_execute para análise/hashes. Skills de estilo/Context Mode já lidas uma vez nesta sessão foram reutilizadas. Escrita por apply_patch nativo. Sem subagentes, descartáveis ou processos; nenhuma pasta temporária foi necessária.

Revisão concluída, fontes liberadas. Próxima ação da coordenação: incorporar o fechamento de BF01 à integração e manter os gates globais/ambiente separados desta aprovação de delta. Nenhuma correção adicional é recomendada neste recorte.
