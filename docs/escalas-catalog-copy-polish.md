# Catálogo — linguagem e orientação prática

`AUX-CATALOG-COPY-POLISH r2` · despacho `AUX-CATALOG-COPY-POLISH:r2:batch253` · gate253/reserva254 · 14/11/2026. Checkout `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

## Resultado

**UI-COPY02 implementado**, limitado a texto e disposição da ajuda em `turno-export.tsx` e `flow-filters.tsx`. A orientação inicial agora descreve a tarefa em duas frases; propriedade do catálogo, fontes sem grade, combinação de filtros e restrições administrativas ficam em ajuda recolhida. A pessoa pode consultar e selecionar sem ler previamente essa explicação detalhada.

Texto principal final:

> Exporte os turnos cadastrados ou os horários dos colaboradores. Consulte a lista e escolha os itens que vão para o arquivo.

| Local | Texto final |
| --- | --- |
| Escolha do alcance | Quais turnos incluir? |
| Alcance global | Todo o catálogo da empresa |
| Alcance por uso | Em uso nos planejamentos escolhidos |
| Mês das fontes | Mês dos planejamentos |
| Escolha das fontes | Escolha um planejamento salvo de cada filial que deseja incluir |
| Consulta inicial | Consultar itens |
| Atualização da consulta | Atualizar lista de itens |
| Fontes carregadas | Planejamentos conferidos: filial…, revisão… |
| Orientação dos filtros | Use os filtros para encontrar os itens. Sem marcar uma opção, o filtro considera todos os itens permitidos. Depois, marque na lista o que vai para o arquivo. |
| Ajuda de interpretação | Sobre o catálogo e os horários dos planejamentos / Como combinar os filtros |

A ajuda secundária conserva integralmente as distinções relevantes:

- O catálogo reúne turnos da empresa; o código não pertence a uma filial. Os filtros mostram uso nos planejamentos escolhidos.
- Um planejamento pode conter apenas horários de referência, sem dias de trabalho montados. Incluir esses horários não comprova presença em um dia.
- Consultar/atualizar a lista não cadastra turnos. Criação, edição e configuração de jornadas de 8h/9h continuam ações administrativas nos controles próprios.
- Duas opções do mesmo filtro abrangem qualquer uma delas; filtros diferentes precisam corresponder à mesma pessoa, explicado por exemplo de setores e filial/colaborador.
- Buscar opções não as seleciona para o arquivo. Alterar filtros retira itens incompatíveis da seleção; o usuário deve conferir os marcados antes de preparar o arquivo.

## Preservação de comportamento e acessibilidade

Não foram alterados valores ALL/USED/CATALOG/EMPLOYEES, payloads, permissões, filtros, seleção, códigos, callbacks, condições de habilitação ou Solver. O botão de atualizar conserva exatamente a operação de consulta; seu texto distingue essa ação de cadastro/sincronização.

Os rótulos visíveis simplificados continuam sendo os nomes acessíveis dos respectivos campos, associados pelo componente Field. Permanecem os nomes dos cinco filtros e das ações de seleção/conferência, o nome acessível do resumo de erro, os refs, `role="alert"`, `tabIndex`, `aria-invalid` e associação do erro de mês. Não foram substituídos nomes por ícones ou textos ocultos divergentes. SWUI01 permanece preservado.

Foram acrescentados somente dois grupos nativos de ajuda recolhida. Tokens, CSS Modules, controles e identidade visual existentes foram mantidos; não há CSS alterado, nova dependência ou mudança de montagem/hook/importação em revisão.

## Verificação proporcional

Leitura do registro UI-COPY02, captura original `export-error-focus.png`, duas fontes e parecer de foco aprovado. Orientações de UI/UX Pro Max, Impeccable e frontend já carregadas foram aplicadas ao produto existente, sem redesign ou subagentes.

- Lint dos dois TSX e tipos da fatia: **saída zero**.
- `git diff --check`: passou nos dois arquivos.
- Navegador com componentes/CSS reais e respostas sintéticas: **390 e 1280 px**, estados inicial, resultados e erro; seis capturas em `outputs/escalas-catalog-copy-polish/`.
- As duas larguras mantiveram resumo de erro focalizado, visível e com contorno sólido de 2 px; limites verticais 89–152 px no móvel e 93–135 px no amplo.
- Documento sem transbordamento: 390/390 e 1280/1280.
- Uma seleção de apenas um dos dois resultados enviou exatamente `codes:[1500]`, modo CATALOG, alcance ALL e fontes vazias. A prévia mostrou somente esse recorte. A abertura da ajuda confirmou os avisos de ausência de grade e de consulta sem cadastro. USED sem fontes continuou impedindo a consulta.

Foram abertas as capturas `initial-390.png`, `results-390.png`, `error-focus-390.png` e `initial-1280.png`. Os outros dois estados amplos também foram capturados e suas asserções passaram. Não houve repetição de suíte de backend ou global. O teste foi de componente isolado; a montagem e a entrega de importação congeladas não foram usadas como fixture.

Context Mode foi usado efetivamente por `ctx_execute` para leitura delimitada, análise e hashes. Edições por `apply_patch` nativo. Scripts, fixture, logs e capturas são evidências persistentes da nova tarefa; nenhum artefato anterior foi apagado ou reescrito. O manifesto registra duas fontes, os artefatos e a estabilidade de 13 referências somente leitura, incluindo as fontes responsáveis pelo foco.

## Limites e liberação

Não houve backend, banco, autenticação real, Solver, geração real de arquivos, E2E da aplicação, produção, commit, push ou deploy. A fixture usa invólucro de 16 px, CSS real e Chromium já instalado; shell/fontes do Next, zoom real de 200% e leitor de tela não foram reproduzidos. A conferência não substitui a integração autorizada posterior.

Fontes liberadas para revisão independente do texto. O processo próprio do navegador encerrou em `finally`; a pasta temporária própria foi concluída pelo helper com saída zero e removida. Nenhum processo compartilhado foi encerrado. Próxima ação: aceite delimitado de UI-COPY02 e incorporação no gate integrado.
