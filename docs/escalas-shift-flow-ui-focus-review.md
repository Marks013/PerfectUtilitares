# Revisão independente da correção de foco dos turnos

Tarefa `AUX-SHIFT-FLOW-UI-FOCUS-REVIEW r1`, despacho `AUX-SHIFT-FLOW-UI-FOCUS-REVIEW:r1:batch240`, gate240/reserva241. Data: 14/11/2026. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

## Resultado

**APPROVED — SWUI01 P3 corrigido no candidato delimitado de componentes.** Nenhum novo achado reproduzível foi identificado no delta de foco. Esta aprovação encerra o achado da revisão anterior; não aprova a montagem da página, o backend, a importação em andamento ou a liberação de produção.

Revisão de fonte alheia, sem implementação. Foram lidas as quatro fontes alteradas, as referências autorizadas e a evidência correspondente. Não foram lidos nem compilados `coverage-import.tsx`, `absence-import.tsx`, `use-escalas-workspace.ts`, `escalas-workspace.tsx` ou `import-replacement*`. Imports e nomes desses arquivos nas fontes autorizadas não foram seguidos.

## Critérios do SWUI01 conferidos

| Critério | Evidência na fonte atual | Evidência de navegador conferida |
| --- | --- | --- |
| Erro de conferência/salvamento conduz a resumo identificável | `use-catalog-task.tsx:28–39` registra solicitação explícita, abre ancestrais details, centraliza e focaliza o alvo conectado; `turno-export.tsx:27` e `shift-swap.tsx:96` têm resumo inicial nomeado, role alert e tabIndex -1 | Falha de manifesto, repetição da mesma falha, preparação de TXT, prévia/impedimento/aplicação de atribuição e cadastro explícito |
| Campo inválido recebe mensagem associada e foco | `shift-swap.tsx:30–45` escolhe o primeiro inválido em ordem inicial/final/busca; linhas 100–102 conectam mensagem por aria-describedby e aria-invalid. `use-export-flow.ts:52` conduz ao mês; `turno-export.tsx:32` conserva a associação | Mês inválido, intervalo invertido, duas datas vazias e data fora dos limites; o runner confere também o texto do elemento descritor |
| Editar/buscar não desloca foco ao resumo | Consultas comuns usam run sem focusOnError. O encaminhamento explícito está em `use-export-flow.ts:90–103,118` e `shift-swap.tsx:83,91`; handlers de edição invalidam a tarefa e não solicitam foco | Falha de consulta com foco num campo editável, edição de mês/datas e erro da busca preservam o controle ativo |
| Resposta obsoleta/cancelamento/contexto não rouba foco | `use-catalog-task.tsx:33,41,49–52` limpa intenção pendente, aborta e confere vida/identidade/sinal da tarefa antes de aceitar erro ou resultado. CatalogScope remonta por escopo visual de acesso | Resposta antiga após mudança de modalidade, busca, acesso, cancelamento e desmontagem preserva foco no controle atual/externo e não reapresenta o resumo antigo |

O contador de pedidos de foco permite repetir a mesma mensagem sem depender de uma mudança de texto. A limpeza feita no erro do cadastro não elimina sua solicitação posterior de foco: `use-export-flow.ts:118` retorna a mensagem pelo onError depois de resetData, e o caso `failed explicit sync survives reset` confere esse caminho. Cancelamento e expiração automática continuam sem encaminhamento indiscriminado; expiração encontrada ao preparar o arquivo é erro da ação explícita.

O estilo usado é o já existente em `escalas.module.css:162`, com contorno de 2 px e afastamento de 3 px. Não houve mudança de identidade visual nem exigência de redesign. A avaliação contextual usou UI/UX Pro Max, Impeccable e frontend-design, preservando a finalidade operacional do sistema React/Next. A busca local `error summary validation --domain ux` retornou precisamente resumo focalizável após falha e erros inline associados, coerentes com o critério original. Foi usado o Python absoluto retornado por load_workspace_dependencies. Não foram executados o launcher de contexto ou o detector amplo do Impeccable: eles ampliariam a leitura/varredura além dos recursos reservados; a aplicação nesta tarefa foi a revisão focal de acessibilidade e do resultado renderizado, sem pontuação de auditoria integral.

## Evidência reaberta e integridade

As cinco capturas finais foram reabertas visualmente: `export-error-focus.png`, `export-invalid-month.png`, `assignment-error-focus.png`, `assignment-invalid-interval.png` e `sync-error-focus.png`, em `outputs/escalas-shift-flow-ui-focus-fix/`. Mostram o resumo ou campo ativo com contorno legível, mensagem próxima e conteúdo sem corte no trecho observado, em temas claro/escuro. As capturas, isoladamente, não comprovam a identidade do elemento ativo.

Essa identidade é demonstrada pelo runner conferido em `browser.cjs:30–38`: exige toBeFocused/toBeVisible, compara document.activeElement com o alvo, mede limites verticais do viewport e verifica document.elementFromPoint no centro do elemento. Para campos, exige aria-invalid true e mensagem existente no ID de aria-describedby. As 20 entradas de `browser.json` têm passed, active, visible e hit verdadeiros. Os três cenários registram documento/viewport de 390/390 ou 1280/1280, sem erro de página. As respostas atrasadas são mantidas e liberadas pelo harness, com checagem de aborto; não se trata apenas de uma captura estática afirmando ausência de roubo de foco.

Foram recalculados os hashes das **11 fontes, 11 recursos de leitura e 18 artefatos** do manifesto no início e no encerramento: nenhuma divergência. Os logs e checks existentes registram 14 testes aprovados em dois arquivos, lint de quatro fontes e tipagem delimitada com saída zero. Esses checks foram inspecionados, não reexecutados nesta revisão: não surgiu hipótese nova que justificasse repetir as suítes ou os 20 cenários. `export-failure.png` continua identificado como diagnóstico histórico da asserção inicial do runner, não como falha atual do produto.

| Objeto conferido | SHA-256 |
| --- | --- |
| Documento da correção | `d9eae926326447035c64c20f082874b6ede84fa5c77998e663527cc2e24a1e1c` |
| Manifesto da correção | `e95934fe7c6d7236901a7d77554646cb2539482c7fc228189f8a4ad0739ab30f` |
| browser.json | `a4623eb9cded02f7b40e831ef3b280be7b0e941670c67a2bca5dcf5b95bb0ed5` |
| use-catalog-task.tsx | `36e302240497cf5e5039c23dd5864e926e63dab09469b4393010eb0a3f03152a` |
| use-export-flow.ts | `b82a103fb80c5d6385b6039ff2b90724d2480a2f12d702fcb3f083ee607a1233` |
| turno-export.tsx | `0905ac271b7c5ffa6af4e3704ef45fc8051d275eefbc72a258ce5072765a8acc` |
| shift-swap.tsx | `e12b9691d5e4821cec3cef6e2266259ad57f923ebcb8ee4aa29fbc1aa29186d3` |

Os hashes individuais restantes permanecem no manifesto original verificado; não houve cópia nem alteração dos artefatos do produtor.

## Limites, próxima ação e liberação

A evidência usa componentes/CSS reais em fixture sintética com API simulada, Chrome headless e movimento reduzido. Não é E2E autenticado, execução no shell completo do Next, leitura por tecnologia assistiva ou prova de comportamento em produção. Navegação completa por Tab, retorno ao fechar na montagem e zoom de 200% continuam para a integração. O teste de ponto confere o centro do alvo no viewport sintético; não certifica ausência de encobrimento em todo shell possível.

SWUI01 pode ser encerrado e o candidato seguir ao gate de integração, conservando esses limites. Não houve execução de banco, Solver, instalação, migração, quality/build global, commit, push ou deploy. A única escrita desta revisão é este documento. Não houve mensagem lateral, subagente, processo, serviço ou arquivo descartável; portanto não há pasta temporária própria pendente de Complete.

Context Mode foi efetivamente usado em `ctx_execute` para validação de disponibilidade, inspeção/derivação de evidência e comparação de hashes, e em `ctx_batch_execute` para coleta delimitada de CSS/stack. Não houve fallback nem escrita por Context Mode. As capturas foram abertas com view_image; a escrita usou apply_patch nativo. Recursos de leitura da reserva241 liberados ao concluir; nenhum recurso da montagem ativa foi reaberto.
