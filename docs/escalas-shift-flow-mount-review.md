# Revisão da montagem de turnos e arquivos

`AUX-SHIFT-FLOW-MOUNT-REVIEW r1` · despacho `AUX-SHIFT-FLOW-MOUNT-REVIEW:r1:batch226` · gate226/reserva227 · 14/11/2026.

**Resultado: APROVADO no recorte da montagem entregue.** Nenhum novo defeito demonstrado. A aprovação não encerra SWUI01, cujo reparo nos componentes internos está reservado a outro responsável, nem certifica backend, autenticação ou E2E real.

## Conferência da integração

- **Entrada única e independente da grade:** `escalas-workspace.tsx:214–222` monta uma instância administrativa fora do bloco de workspace aberto. Não exige planos salvos. O teste próprio cobre ausência de planos, planos com contexto fechado, estado de salvamento destacado e administrador com contexto ativo. O patch remove a instância antiga de Ajustes.
- **Guardas de exibição:** exige conta administrativa irrestrita e `export.integration`. Contexto ausente e conta com concessões apenas locais não recebem o painel. A filial mantém atribuição conforme `escalaCatalogActions`, sem receber criação de definições ou integração administrativa. São guardas de UI; autorização do servidor não foi avaliada.
- **Definições e foco:** o atalho com workspace autorizado abre Ajustes, aguarda sua montagem, abre os dois grupos e focaliza o resumo “Turnos específicos” (`:149–160`, `:219`, `:334`). Sem workspace, abre e focaliza o seletor existente, sem criar/abrir um plano automaticamente. O runner exercita Enter, verifica o elemento ativo e sua visibilidade por ponto na tela. Não registra atualização de dados ou SYNC implícito.
- **Contexto e trabalho pendente:** a chave inclui workspace/revisão, filial, horizonte, mês visível, dirty e candidata (`:193`). O exportador recebe bloqueio durante operação, alterações, recuperação, candidata ou salvamento ativo incompleto (`:215`). Sem workspace aberto, o estado de save destacado não impede consulta global. Não houve alteração do hook nesta montagem; a fila real de salvamento não foi reavaliada.
- **Atribuição existente e arquivos básicos:** o caminho de equipe continua usando ShiftSwap e reabre o mesmo plano após sucesso, desde que ainda seja o contexto atual (`:295–296`). O cenário de filial registra seleção, prévia, confirmação e callback de atualização; os botões básicos PDF/XLSX continuam presentes. Isso prova a integração visual simulada, não a geração real desses documentos.

## Evidências verificadas

Foi lido o workspace atual, seu teste próprio, patch de montagem, documento de entrega, contratos de acesso permitidos e evidências do diretório autorizado. As fontes de `shift-catalog/`, hook/model e backend em edição não foram abertas. Os 13 hashes readonly do manifesto foram tratados como corte histórico conferido pelo coordenador, sem recalcular os arquivos proibidos ou atribuir alterações posteriores do reparo de foco à montagem.

Integridade recalculada: **2 fontes e 22 artefatos**, sem divergências. Documento e manifesto coincidem com os hashes do despacho:

| Fonte | SHA-256 |
| --- | --- |
| `escalas-workspace.tsx` | `ba0ae29ad7fb13707a512f594a20c748b75199dbeeb58e8bcaa7e7ebffe083cc` |
| `workspace-catalog-integration.test.tsx` | `48cedff3ffd39c08961a6ed14e779369c027511129cdec7829946f7c6299594d` |
| `docs/escalas-shift-flow-mount.md` | `4f63c84c775c786ae3ee7d17034aa21f90f3cfd9a42e7e65c118cea3e7c9da9a` |
| `outputs/escalas-shift-flow-mount/manifest.json` | `4ce0d82e22d3ebe346b9ee629731be96ff2ef53d34eda3a88282b92aac31abbf` |

Checks existentes reaproveitados: 7/7 testes no log, lint dos dois TSX e tipagem restrita com saída zero. Quatro cenários sintéticos aprovados (`empty`, `closed`, `active`, `branch`), sem erros de página; documento/viewport 390/390 nos três cenários móveis e 1280/1280 no ativo. O runner também verifica remoção do arquivo anterior ao abrir plano, mudar revisão/período, editar e trocar acesso. Nenhuma suíte foi repetida sem hipótese nova.

Capturas abertas nesta revisão: `empty-catalog-available.png`, `administrative-definition-path.png` e `branch-existing-assignment.png`. Conferem o catálogo móvel, foco visível no destino administrativo e atribuição móvel com rótulos completos e ações empilhadas. A tabela mantém rolagem local. São trechos da página; não equivalem a cobertura visual de todos os estados. `branch-failure.png` é diagnóstico histórico da fixture inicial, não falha final.

## Limites e liberação

A análise preservou o produto e sistema visual, usando as orientações de UI/UX, Impeccable e frontend já carregadas. Não houve redesign, mudança de código ou crítica independente por subagentes. Context Mode foi usado efetivamente por `ctx_execute` para código, evidências e integridade; escrita nativa por `apply_patch` somente neste parecer.

Fixture com componentes/CSS reais e hook/API simulados não prova autenticação, persistência, geração de PDF/XLSX, concorrência de SAVE ou servidor real. Shell/fontes do Next, zoom de 200%, percurso completo por Tab e leitor de tela permanecem para integração. SWUI01 continua em sua reserva própria e exige avaliação do delta de foco; este parecer não o reabre nem o declara corrigido.

Próxima ação: integrar o reparo reservado e executar os gates reais de liberação quando autorizados. Leituras da montagem liberadas após conferência final de estabilidade. Nenhum arquivo descartável, processo ou serviço foi criado; não há temporário próprio a concluir. Sem commit, push ou deploy.
