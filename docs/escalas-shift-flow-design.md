# F09/F10 — desenho de turnos, vínculos e arquivos

**AUX-SHIFT-FLOW-DESIGN r1 — 2026-11-14.** Despacho `AUX-SHIFT-FLOW-DESIGN:r1:batch144`; gate144 `e6fbd9fcf39ec2437dc0657d2c7c8cdab767c4a3d744fec6c37f218d78ff13d1`; reserva145. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

Este documento é uma proposta implementável, apoiada em leitura estática. Não declara F09/F10 implementados, não altera o contrato r3, não substitui a revisão de autorização do 02 e não autoriza execução. A única escrita desta tarefa é este arquivo. Os critérios de aceite usados são os de `C:/Users/samue/Desktop/PerfectUtilitares/outputs/apoio-maestro-20261113/criterios-interface-turnos.md`, confrontados com `PRODUCT.md`, `DESIGN.md` e as fontes listadas abaixo.

## 1. Decisões de produto

1. Administrador cria ou ajusta **definições**; a filial atribui somente uma definição existente, permitida para a pessoa e o período. Configurar a alternância de 8h/9h continua administrativo. Atribuir um turno não muda carga semanal, aprovação ou regra de distribuição.
2. O catálogo é **da empresa**. Não existe filial proprietária de um código. Filtrar por filial, colaborador, setor ou matrícula significa consultar os vínculos de referência desses colaboradores em revisões escolhidas; não significa transferir propriedade do turno.
3. A integração administrativa oferece dois modos: **Turnos cadastrados** e **Turnos por colaborador**. O primeiro seleciona definições e gera TXT2. O segundo seleciona pessoas/referências e oferece TXT1, além de TXT2 com os códigos necessários àquele mesmo conjunto. Não há TXT1 de uma definição sem pessoa e matrícula.
4. Os filtros reduzem o universo consultado; a seleção define o conjunto enviado à conferência. Seleção vazia significa zero, inclusive após um filtro sem resultados. Jamais significa todos.
5. Uma conferência identifica modo, conjunto, revisões, referências, pendências e quantidade de linhas por formato. Trocar qualquer entrada invalida o aceite e os arquivos preparados. Baixar exige conferência compatível e revalidação no servidor.

## 2. Mapa verificado do produto atual

Os caminhos desta seção são relativos ao checkout. As linhas indicam o snapshot lido, não uma promessa de estabilidade após integração.

| Fonte real | Entrada/saída e suporte observado | Limite relevante |
| --- | --- | --- |
| `web/src/lib/escalas/shift-catalog/contracts.ts:2` | `TurnoClockMarks`: quatro textos de hora. `TurnoCatalogEntryDto`: `code`, `markings`, `name`. Página: `entries`, `nextCursor`, `pageSize`. | Não há filial, situação ativa, nome comercial persistido, revisão do catálogo ou vínculo de pessoa no DTO. |
| `web/src/app/api/escalas/turnos/route.ts:42` e `catalog.ts:47` | GET com `search` até 48 caracteres, `cursor` numérico e `limit` 1–100, padrão 30. Busca por código/horas; cursor por código crescente. | Não consulta filial, colaborador, setor ou matrícula. Não informa total nem congela todas as páginas. |
| `turnos/route.ts:21` e `catalog.ts:94` | POST `SYNC`: `sources[{workspaceId,expectedRevision,localShiftIds}]`, `confirm:true`; retorna entradas e quantidades criadas/inalteradas. Até 50 fontes e 120 turnos/fonte. | Inclusão explícita a partir de revisão salva; não é CRUD de marcações livres. O primeiro lote exige referências de dezembro/2026 (`catalog.ts:164`). |
| `domain.ts:84` e `catalog.ts:149` | Primeiro lote ordena marcações numericamente e começa em 1500; lotes posteriores usam contador e reutilizam tupla já existente. | Códigos já emitidos não são renumerados pelo algoritmo. Não há operação de alteração/exclusão de código; PATCH/DELETE da rota não são aceitos. |
| `turnos/route.ts:30`, `contracts.ts:35` e `swap.ts:34` | POST `PREVIEW_SWAP`: planejamento, revisão esperada, pessoa, código e início/fim. Retorna `previewId`, alvo, dias afetados/preservados, problemas, nível de validação e `canApply`. | Uma pessoa e um intervalo por solicitação. Catálogo existente não implica compatibilidade com pessoa/configuração. |
| `contracts.ts:46` e `swap.ts:166` | POST `APPLY_SWAP` repete a intenção e acrescenta `previewId`, `confirm:true`; recalcula e persiste pela revisão esperada. | Não basta enviar uma prévia antiga. A proposta desta tarefa preserva esse desenho; a revisão das guardas pertence ao 02. |
| `turnos/export/manifest/route.ts:18`, `contracts.ts:79` | POST com mês/ano e `selections[{workspaceId,revision,employees[{employeeId,localShiftId}]}]`; até 50 planejamentos e 250 escolhas/fonte, corpo até 512 KiB. Resposta: `manifestId`, validade, mês/ano, `rowCount`, omissões, formatos. | Não recebe modo de catálogo puro, filtros ou conjunto explícito separado de referências faltantes. `rowCount` conta pessoas, não linhas TXT2. |
| `export.ts:43`, `:97` | Exige revisão atual, mês compatível e um planejamento por filial canônica. Percorre todas as pessoas ativas no mês; usa as escolhas recebidas para resolver a referência de cada uma. | Pessoa não enviada vira omissão, não fica fora do universo. `employees:[]` não exporta todos, mas produz omissões para o universo da fonte. Isso impede apresentar essa operação como seleção exata sem esclarecer a diferença. |
| `export.ts:157`, `catalog.ts:199` | Manifesto interno versão 1 guarda fontes/revisões/escolhas e hash das linhas; expira em 15 minutos. Download relê as fontes e compara linhas. | Resposta não devolve prévia das linhas, conjunto incluído ou contagens por formato. O hash atual cobre linhas, não um resumo completo de seleção e pendências. |
| `turnos/export/route.ts:9` | GET com `manifestId`, `format=TXT1|TXT2`, `acceptOmissions=true|false`; TXT em anexo, `text/plain; charset=utf-8`, sem cache; falhas estruturadas. | Não recebe filtros no download. Snapshot liberado ao 02 após leitura, para acrescentar guarda final depois dos bytes, sem mudança de DTO planejada. Não relido nesta tarefa. |
| `domain.ts:110` | TXT1: matrícula e quatro marcações. TXT2: código, nome composto pelas quatro horas e as quatro marcações; deduplica por código e ordena numericamente. UTF-8 sem BOM, CRLF. | TXT1 não contém código ou datas. TXT2 atual deriva das linhas de pessoas exportáveis; não representa todo o catálogo nem necessariamente todas as definições escolhidas na tela. |
| `reference-choices.ts:23` | `employeeReferenceShiftChoices`: variantes de WORK efetivamente registrado, se houver; senão referências base/manuais no mês e vínculo. Retém origem e datas no rótulo. | Não cria presença. Mais de uma variante exige escolha explícita para um formato sem datas. Não usar `shiftIds[0]`, duração igual ou nome para adivinhar referência. |
| `shift-catalog/shift-swap.tsx:12` | Busca/paginação de catálogo, escolha de código, datas, prévia e confirmação. | Não recebe lista contextual de códigos aprovados. A busca é global à empresa; a compatibilidade só é apurada na prévia. |
| `shift-catalog/turno-export.tsx:20` | Mês, um planejamento por filial, carregamento das revisões, escolha de variantes, conferência, cadastro explícito de referências ausentes, aceite de omissões e arquivos. | Não tem os cinco filtros pedidos nem seleção de pessoas entre páginas, catálogo puro ou linhas da prévia. Inicialmente escolhe um planejamento por filial (`:48`); isso deve virar escolha visível e confirmada. |
| `shift-catalog/client.ts:5` | Cliente JSON, erro de conflito e aviso de desbloqueio. | Não fornece prazo próprio e não verifica cancelamento depois do JSON. Reutilizar a disciplina já adotada na recuperação de acesso; não copiar respostas tardias para um novo contexto. |
| `escalas-workspace.tsx:99`, `:253`, `:296` | Integra `ShiftSwap` na equipe; usa `escalaCatalogActions`. Integra `Shifts` em configuração e `TurnoExport` em ajustes administrativos, atualmente dentro de um planejamento aberto. | Catálogo puro precisa poder abrir sem planejamento existente; uso por pessoa continua exigindo fontes salvas. `results.tsx` é revisão de escala/avisos, sem integração de catálogo: não receber um segundo fluxo de TXT. |

### Modelo real e suas identidades

`schema.prisma:354` define `ShiftCatalogEntry` com `tenantId`, código e quatro minutos; unicidade por empresa/código e por empresa/tupla. Não há filial, employeeId, segmento completo, status ativo ou alias persistido. `ShiftCatalogSequence:345` guarda o próximo código. `TurnoExportManifest:369` guarda JSON, proprietário/sessão e validade; uma evolução do payload pode usar esse JSON sem exigir uma coluna por filtro.

`EscalaWorkspace:234` pertence à empresa e filial, tem período/revisão/status; `EscalaRevision:283` guarda o `input` JSON de cada revisão e a referência de aprovação. As pessoas e os turnos locais estão nesse JSON, não em uma tabela de vínculos do catálogo.

Em `types.ts`, `EscalaShift` usa ID local, nome e segmentos `WORK|BREAK|PAID_BREAK`, com fim que pode ultrapassar 1440. `EscalaEmployee` usa ID, matrícula **string**, setor **string**, referências base e escolhas manuais datadas; `activeFrom` vazio significa vínculo desconhecido. `EscalaAssignment` distingue `WORK|DUTY|OFF|ABSENCE|HOLIDAY` e bloqueio. `EscalaManualShiftOverride` liga código, ID local, marcações e vigência. Não há ID canônico global de setor nem motivo canônico de férias nesses tipos.

`access-contracts.ts:68` distingue visualmente definição administrativa e atribuição por `shift.manage`; é indicação de interface, não autorização. O contrato HTTP identifica sua versão como 1; “r3” neste documento designa a revisão de integração vigente, não a criação de uma versão HTTP 3.

## 3. Fluxos propostos

### F09 — cadastrar, ajustar e atribuir

**Administrador — definição:** em Configurações administrativas, manter uma única entrada “Turnos cadastrados da empresa”. Mostrar código, marcações, tempo de trabalho, intervalo e “Usado nas referências selecionadas” quando houver fontes. “Preparar novo turno” abre edição de segmentos do planejamento em rascunho; não grava catálogo ao digitar. “Salvar definição no planejamento” usa a persistência/revisão já existente; “Cadastrar no catálogo da empresa” envia SYNC somente dos IDs locais conferidos, com confirmação explícita. Mostrar quantos códigos novos e quantas definições já existiam. Se o primeiro lote ainda estiver pendente, informar a exigência real de dezembro/2026; não tentar novembro ou cadastrar por efeito colateral da exportação.

**Ajustar uma definição usada:** oferecer “Criar nova definição a partir desta”. A cópia recebe novo ID local; o original, o código e os vínculos históricos permanecem. Após salvar e sincronizar, marcações já existentes reutilizam seu código; marcações novas recebem outro código. “Nova definição cadastrada; escolha onde atribuir” encerra a ação. Não trocar automaticamente o turno de todos que usavam o anterior. Alterar o número de um código ou regravar suas horas exigiria outro desenho de versionamento e não faz parte da mudança mínima. Um alias livre global também não existe hoje e não será simulado como campo persistido.

O ponto de integração confirmado é `<Shifts>` em `escalas-workspace.tsx:302`. O conteúdo de `configuration.tsx` ficou fora do READ autorizado; antes de editar esse arquivo numa execução futura, será necessário liberá-lo para decidir se o editor existente permite copiar a definição com novo ID. Alternativa delimitada: novo `shift-catalog/catalog-definitions.tsx` que prepara a cópia em `EscalaInput` e usa o salvamento existente, sem novo CRUD global. A decisão de aprovação da configuração resultante permanece no fluxo administrativo atual; sincronizar um código não aprova sua atribuição à filial.

**Filial — atribuição:** em Equipe, junto da pessoa, “Atribuir turno cadastrado”. Exibir filial, pessoa, matrícula, revisão, horário atual e “Aplicar a partir de / Aplicar até”. Oferecer somente códigos existentes liberados para essa pessoa/configuração; a prévia continua fazendo a validação integral. A necessidade de uma consulta contextual para isso está definida na seção 5. Não disponibilizar entrada de horas livres, SYNC, regra 8h/9h, importação ou TXT.

“Conferir troca” mostra horário anterior e proposto, intervalo, datas afetadas, datas preservadas e problemas. Com `NO_SCHEDULE`, dizer “Altera a referência de horário; não cria dias de trabalho nem folgas”. Com grade, os números de dias referem-se às atribuições reais da prévia. `canApply:false` mostra orientação junto da causa. “Confirmar e salvar atribuição” envia APPLY_SWAP; só após resposta válida e revisão atualizada dizer “Atribuição salva”. Não chamar a ação de salvar rascunho local. Trocar pessoa, período, código, revisão ou acesso cancela a requisição e remove a prévia anterior.

`swap.ts` já preserva ausência, folga, feriado, bloqueio e trabalho legado sem confirmação de desbloqueio. Há conflito que impede a troca inteira quando um trabalho bloqueado contradiz a referência manual. A UI não promete aplicação parcial nesses casos. Sem matrícula não se inventa uma: a atribuição usa ID da pessoa; o TXT terá pendência própria. Sem referência controlada (`MISSING`, `UNTIMED`), vínculo fora da vigência ou pessoa excluída da geração, não oferecer criação automática de horário. Não confundir isso com exportação: um TIMED excluído da geração pode manter uma referência real exportável, como coberto pelos testes existentes.

### F10 — dois modos na mesma ferramenta administrativa

| Modo | Universo e apresentação | Arquivo |
| --- | --- | --- |
| Turnos cadastrados — Todo o catálogo | Definições da empresa, inclusive sem atribuição. O mês é “Mês de referência do arquivo”, não data de criação dos turnos. Filtro Turno e busca código/horas. | TXT2 das definições explicitamente selecionadas, uma linha por código. Não depende de pessoas exportáveis ou matrículas. |
| Turnos cadastrados — Usados nas referências selecionadas | Escolher mês e um planejamento/revisão por filial; aplicar os cinco filtros aos vínculos de referência; projetar códigos únicos. Mostrar origem e quantidade de vínculos por código. | TXT2 somente dos códigos selecionados que pertencem à projeção conferida. Pode conter definição usada por pessoa sem matrícula; esse modo exporta definições. |
| Turnos por colaborador | Mesmo contexto de fontes, cinco filtros, pessoas e variantes de referência. Uma pessoa pode escolher somente uma referência para este arquivo. | TXT1 das pessoas exportáveis selecionadas. TXT2 opcional com os códigos únicos dessas mesmas linhas, usando a mesma conferência. |

Os modos “Todo o catálogo” e “Usados nas referências selecionadas” são opções de alcance dentro de Turnos cadastrados, não uma terceira finalidade. Ao usar filtro relacional em Todo o catálogo, mudar explicitamente o alcance para Usados, exigir fontes e limpar seleção/prévia; mostrar essa mudança. Não ignorar um filtro preenchido nem esconder turnos sem atribuição quando Todo o catálogo continua selecionado.

Mover a montagem administrativa de `TurnoExport` para um ponto que não dependa de `allowedPlans.length > 0` ou de uma escala aberta. Preservar as capacidades e a área administrativa. Sem fontes, Todo o catálogo continua utilizável; os outros dois alcances mostram “Escolha um mês e um planejamento por filial”. Inicialmente nenhum planejamento/pessoa/código é selecionado para arquivo. Não escolher automaticamente a revisão mais recente; apresentá-la como opção com data/status para confirmação humana.

## 4. Regra exata dos filtros e da seleção

### Identidades e vínculo com o catálogo

- Pessoa: par `(workspaceId, employeeId)`, sempre acompanhado da revisão da fonte. Matrícula não substitui esse par e não une pessoas de filiais diferentes.
- Setor: par `(workspaceId, sectorText)` retornado pela fonte; revisão vem do contexto. O modelo atual não oferece sectorId global. Não juntar setores de duas filiais só porque exibem o mesmo nome. O seletor pode agrupar visualmente, mas transmite os pares exatos.
- Turno global: código do catálogo da empresa autenticada. ID local: `(workspaceId, localShiftId)`; não é o código. Resolver marcações representáveis por igualdade exata da tupla, nunca por duração ou nome. Escolha manual já tem código, mas ainda precisa ser conferida contra a tupla atual.
- Matrícula: comparação textual exata dos valores escolhidos, conservando `0007`, `7` e alfanuméricos como valores distintos. Campo de busca textual ajuda a encontrar opções; não usa tipo number, parseInt, preenchimento ou retirada de zeros. Na lista, exibir filial/pessoa para desambiguar matrículas iguais.

Para fontes do mês escolhido, formar relações `(fonte, revisão, filial, pessoa, setor, matrícula, localShiftId, origem, datas, catalogCode ou pendência)`. Reutilizar `employeeReferenceShiftChoices` para referências válidas. WORK significa aplicação real registrada na grade; BASE/MANUAL significa referência vigente, sem prova de presença. Se houver WORK, não voltar silenciosamente à base quando todos os IDs de WORK estiverem obsoletos. Ausência de código ou referência incompatível é uma pendência identificada, não um vínculo inventado. A seleção de filial usa o código canônico apurado no servidor.

**Predicado:** alternativas do mesmo filtro se combinam por OR; filtros diferentes por AND. Arrays de filtro vazios significam ausência daquela restrição. As condições relacionais devem ser satisfeitas pelo **mesmo vínculo/pessoa**, antes de projetar códigos únicos. Um turno usado por Ana no setor A e Bruno no setor B não satisfaz “Ana E setor B”. Um código sem vínculo real não aparece no alcance Usados. Um vínculo sem código pode aparecer como pendência por pessoa; não vira um código fictício no catálogo.

Em Turnos por colaborador, o filtro Turno exige uma referência válida da própria pessoa com aquele código. Pessoas sem código continuam visíveis sem essa restrição e recebem pendência se selecionadas. Para escolher a referência do arquivo, mostrar todas as variantes reais e suas datas/origem; um filtro de turno pode restringir quais são compatíveis com o recorte, mas não escolhe silenciosamente uma variante quando a pessoa tem mais de uma no período. Exigir confirmação explícita. Alterar a escolha para fora do filtro é negado ou exige alterar o filtro e reconferir.

### Paginação, seleção e atualização

1. Para a mudança mínima, a UI carrega as fontes salvas escolhidas e enumera o catálogo pelas páginas existentes. Filtros de pessoas são locais sobre esse corpus completo e limitado; não se anuncia filtragem de bytes até existir o manifesto versão 2. Não precisa criar uma API genérica de buscas para F10.
2. Enquanto faltarem páginas, mostrar “Carregando opções” e a quantidade conhecida. “Selecionar esta página” seleciona apenas as linhas visíveis. “Selecionar todos os N resultados” só fica disponível quando o corpus necessário está completo e N é conhecido. Não chamar a primeira página de todos os resultados. Se a consulta não puder terminar, preservar erro/repetição e não oferecer seleção global.
3. Guardar um conjunto explícito de chaves. Paginar preserva a seleção; mostrar “N selecionados, M nesta página” e permitir limpar toda a seleção. Uma seleção global é materializada como IDs/códigos, não como `[]` nem um booleano vago `all` enviado ao servidor.
4. Mudar filtro recalcula as opções dependentes e remove opções/pessoas/códigos/referências que não pertencem ao novo resultado. Mostrar “N itens retirados da seleção porque não correspondem aos filtros”. Preservar somente a interseção comprovada; invalidar toda a conferência, aceite e URLs. Não esconder seleção exportável fora do filtro.
5. Mudar modo, empresa/acesso, mês, filial/fonte ou revisão limpa a seleção e a conferência. O rascunho da grade usa o tratamento já existente de troca de contexto; não é descartado por “Limpar filtros”. Não persistir seleção de exportação entre acessos. Uma resposta antiga não repõe seleção nem emite bloqueio para outro acesso.
6. “Atualizar lista” relê as fontes e páginas e invalida a conferência. Manter uma opção incompatível só como informação de que foi removida, nunca como seleção enviável. Nenhum resultado: “Nenhum resultado com estes filtros”, contagem zero, seleção zero e ação de conferir desabilitada. Limpar filtros restaura apenas o universo autorizado; não seleciona tudo nem altera cadastros.

## 5. Menor evolução de contrato proposta

Esta seção fixa a proposta para posterior divisão backend/UI. Os nomes novos são propostos, não exports existentes. Preservar `access-contracts.ts`, `types.ts`, os DTOs atuais de `shift-catalog/contracts.ts` e os corpos r3 já aceitos. Não mudar o significado de `employees` do manifesto antigo para corrigir o novo fluxo: há testes que exigem as omissões antigas.

### 5.1 Consulta contextual da atribuição

Adicionar **GET `/api/escalas/turnos/opcoes`**, com `workspaceId`, `expectedRevision`, `employeeId`, `effectiveFrom`, `effectiveUntil`, `search`, `cursor`, `limit` (mesmos limites de catálogo; contexto todo obrigatório). Resposta: `{ context: { workspaceId, revision, employeeId, effectiveFrom, effectiveUntil }, entries: TurnoCatalogEntryDto[], nextCursor, pageSize }`.

O backend resolve os códigos existentes liberados pela configuração dessa pessoa e datas, usando a mesma regra de elegibilidade aplicada pela troca; a responsabilidade de autorização não é implementada pela UI. “Permitido pela configuração” não significa “prévia da grade aprovada”: descanso, fechamento, bloqueios e validação integral continuam em PREVIEW_SWAP. Nenhum match retorna página vazia, jamais todo o catálogo. Não oferecer esse resultado se revisão/contexto devolvido não corresponder à requisição. Falta de aprovação é erro específico com orientação administrativa, não lista global de fallback. Essa rota evita alterar o GET global r3 ou pedir ao frontend acesso ao snapshot protegido. Não acrescentar a lista de permissões ao DTO público de pessoa.

### 5.2 Manifesto com seleção exata e dois modos

Ampliar **POST `/api/escalas/turnos/export/manifest` por união discriminada**: corpo antigo, sem `selectionVersion`, mantém caminho/payload/resposta atuais; corpo com `selectionVersion:2` usa o fluxo abaixo. Declarar os novos tipos em `shift-catalog/flow-contracts.ts`, importados pela rota e UI. Não editar o contrato r3 para fazê-lo aparentar suporte já entregue. O nome versão 2 refere-se somente à nova seleção/payload de manifesto.

Campos comuns propostos:

```ts
type Source = { workspaceId: string; revision: number };
type PersonKey = { workspaceId: string; employeeId: string };
type SectorKey = { workspaceId: string; value: string };
type Filters = {
  branchCodes: string[];
  employeeKeys: PersonKey[];
  sectors: SectorKey[];
  catalogCodes: number[];
  registrations: string[];
};
type SelectionManifestRequest = {
  selectionVersion: 2;
  year: number;
  month: number;
  filters: Filters;
} & (
  | { mode: "CATALOG"; scope: "ALL"; sources: []; codes: number[] }
  | { mode: "CATALOG"; scope: "USED"; sources: Source[]; codes: number[] }
  | { mode: "EMPLOYEES"; sources: Source[];
      members: (PersonKey & { localShiftId: string | null })[] }
);
```

Todos os filtros são explícitos. Em ALL, filtros relacionais preenchidos são inválidos; a UI muda para USED antes de enviar. Em EMPLOYEES, `null` significa pessoa selecionada com referência faltante a diagnosticar; não significa excluir nem inferir. Em todos os modos, `codes:[]` ou `members:[]` recebe erro de seleção vazia. O servidor valida fonte, revisão, contexto, pertinência de IDs e satisfação dos filtros pelo mesmo vínculo. Uma seleção pode ser subconjunto dos resultados, mas nunca conter uma chave fora deles. Escolhas duplicadas são erro. Não confiar em nomes/contagens/horas enviadas pelo navegador.

Limites propostos para a extensão: mês/ano e IDs seguem os limites r3; até 50 fontes, uma por filial; até 250 membros de cada fonte e 1.000 membros no total; até 5.000 códigos em CATALOG; corpo até 512 KiB. Aplicar limites também às opções de filtros/chaves, deduplicadas e de tamanho limitado; arrays de IDs/pessoas/setores até 1.000, códigos até 5.000 e filiais até 50. Matrícula e texto de setor devem seguir a validação canônica da origem quando liberada; não inventar truncamento neste contrato de desenho. Exceder limite produz orientação para reduzir o recorte, sem exportar automaticamente só a primeira página ou fragmentar arquivos. Esses limites são propostas verificáveis, não capacidade medida em produção.

Resposta versão 2 proposta: discriminada por `selectionVersion` e `mode`, com `manifestId`, `expiresAt`, `selectionDigest`, contexto normalizado (`year`, `month`, `sources`, `filters`, alcance), conjunto selecionado normalizado e prévia das linhas. Para CATALOG, linhas `{code,name,markings}` e apenas TXT2. Para EMPLOYEES, linhas `{workspaceId,employeeId,registration,localShiftId,code,markings}`; formatos TXT1/TXT2. Devolver `counts` separados: encontrados no recorte, selecionados, pessoas incluídas, códigos incluídos, linhas TXT1, linhas TXT2, omitidos e bloqueios. CATALOG não usa “pessoas incluídas” como contagem principal.

`omissions` versão 2 identifica somente membros **selecionados** sem linha, com chave de pessoa, matrícula textual original e motivo. Reusar motivos atuais quando corretos e acrescentar `REGISTRATION_MISSING` para matrícula vazia. Vínculo inexistente/ID estrangeiro não é omissão aceitável: é erro de solicitação. `blockers` contém problemas que exigem correção antes de qualquer arquivo, com chaves das pessoas afetadas e orientação. O conjunto incluído + omitido deve particionar exatamente a seleção válida; pessoas apenas filtradas para fora não entram na lista de omissões. Linhas de catálogo não dependem da exportabilidade de matrícula da pessoa que demonstra seu uso.

Guardar payload interno `version:2` no JSON de `TurnoExportManifest`, sem migração de schema para esses campos. O digest cobre versão, modo/alcance, filtros normalizados, fontes/revisões, conjunto exato escolhido, referências, tuplas/códigos/nome emitido, linhas ordenadas, omissões e bloqueios. O GET de download mantém `manifestId`, `format` e `acceptOmissions`; despacha pelo payload interno e rejeita TXT1 em CATALOG. O download reconstrói/revalida o mesmo recorte e compara o resumo completo antes de produzir os bytes. Pode servir as linhas congeladas após essa validação; nunca um recorte diferente sob o mesmo aceite. Validade inicial de 15 minutos reaproveita a política atual. Um acréscimo não relacionado no catálogo não precisa invalidar uma seleção exata imutável; alteração de tupla/código selecionado, fonte, vínculo ou autorização invalida. A UI invalida sempre que o usuário atualizar a lista.

Essa extensão não promete filtros no servidor antigo: até ela existir, filtros visuais podem servir à consulta, mas “Conferir seleção filtrada para arquivo” permanece indisponível com orientação honesta. Também não simular catálogo puro mandando uma matrícula vazia ou escolhendo uma pessoa de suporte.

## 6. Integridade dos arquivos e das referências

| Caso | Decisão proposta e efeito visível |
| --- | --- |
| Matrícula `0007`, `7` ou `AB07` | Preservar bytes textuais e distinguir. Sem conversão numérica. Nome não substitui matrícula. |
| Matrícula ausente | Pessoa permanece selecionada com pendência; não emitir linha TXT1 vazia. Parcial somente com aceite administrativo dos omitidos. Não impede uma definição legítima do catálogo em modo CATALOG. |
| Matrícula duplicada no conjunto TXT1, inclusive em filiais diferentes | Diagnosticar **todas** as pessoas da colisão e bloquear a conferência para download até corrigir a origem ou retirar explicitamente uma seleção. Não manter arbitrariamente a primeira e omitir só a seguinte, como acontece hoje em `export.ts:146`. |
| Delimitador/controle em matrícula | Manter rejeição recuperável; não sanitizar silenciosamente a identidade. Mostrar o campo de origem a corrigir sem gravá-lo pela exportação. |
| Várias referências no mês | Mostrar variantes e vigências; exigir uma escolha para TXT sem datas. Não alegar que a linha reproduz todas as trocas diárias. A grade não muda por escolher referência de arquivo. |
| ID local obsoleto, código ausente ou tupla divergente | Não adivinhar por nome/duração. “Referência indisponível nesta revisão; atualize ou peça ao administrador”. Se apenas faltar código para definição representável, oferecer SYNC explícito ao administrador; invalidar e regenerar a conferência depois. |
| Código inativo | O schema atual não modela inativação. Não exibir selo fictício nem implementar filtro de ativo. Se a política futura exigir aposentadoria, abrir evolução própria de estado/histórico; até lá, permissão contextual e compatibilidade são verificadas no servidor. |
| Noturno ou fim no dia seguinte | Mostrar os segmentos reais com “dia seguinte”. O catálogo de quatro marcações atual não representa esse caso; `OVERNIGHT` é pendência do formato. Não aplicar módulo 24, cortar a jornada ou tratar 00:00 como dado faltante por si só. |
| Pausa remunerada, mais de dois períodos de trabalho ou marcações parciais | Preservar segmentos originais; explicar `PAID_BREAK`, `TOO_MANY_PERIODS`, `PARTIAL` ou `ZERO_MARKINGS`. Não achatar informação para conseguir um código. Um período real usa segundo par `00:00,00:00`; isso é diferente de quatro zeros. |
| Ausência, folga, feriado, DUTY ou bloqueio | Manter a categoria original e os registros protegidos. Ausência não é férias sem motivo canônico. Referência pode existir sem grade; não fabricar WORK, crédito de horas ou cobertura. Atribuição usa a prévia e seus problemas reais. |
| Sem vínculo conhecido | `activeFrom:""` não cria admissão fictícia. Usar a interpretação canônica já existente e exibir “Vínculo não informado” quando pertinente. Não inventar data para incluir ou excluir pessoa. |

TXT1 e TXT2 do modo EMPLOYEES derivam das **mesmas linhas incluídas**. Para cada linha TXT1 há uma tupla que corresponde ao código na prévia e no TXT2 complementar. TXT1 não escreve esse código, portanto a UI não deve prometer um campo que não existe. TXT2 tem uma linha por código, mesmo que dez pessoas compartilhem o turno. Pessoas omitidas não adicionam códigos ao TXT2 complementar. Para exportar outras definições, usar CATALOG e uma conferência separada.

Preservar UTF-8 sem BOM, CRLF, ordem determinística e os layouts atuais de `renderTurnoTxt`. Nenhum arquivo é baixável com zero linhas. Omissão parcial exige lista de selecionados afetados e aceite administrativo vinculado ao digest; qualquer mudança limpa o aceite. Sucesso HTTP com corpo vazio ou MIME diferente de text/plain é falha de arquivo, não link de download. Revogar URLs preparadas quando a conferência mudar, expirar ou o acesso terminar.

## 7. Estados e linguagem da interface

Usar `Field`, botões e tokens/CSS Modules existentes. Não acrescentar biblioteca, dashboard ou cartões ornamentais. Rótulos persistentes, controles de pelo menos 44 px, foco visível, mensagens associadas aos campos e tabelas com identificação legível em tela estreita seguem `DESIGN.md`.

| Estado | Texto/ação junto da informação relevante |
| --- | --- |
| Inicial | “Escolha o que deseja exportar” → Turnos cadastrados / Turnos por colaborador. Ajuda curta descreve o conteúdo. |
| Consultando | “Consultando turnos…” / “Carregando referências…”; impedir clique duplicado, permitir cancelar consultas e repetir após prazo. |
| Vazio real | “Nenhum resultado com estes filtros” e “Limpar filtros”; não oferecer baixar todos. |
| Sem catálogo | Administrador: “Nenhum turno cadastrado; prepare uma definição e confirme o cadastro”. Filial: “Peça ao administrador para cadastrar e liberar um turno”. |
| Sem permissão/aprovação | “Esta ação depende da configuração aprovada pelo administrador”. Nenhum botão de correção administrativa para a filial. Erro de consulta não é ausência de aprovação. |
| Seleção alterada | Quantidades encontradas/selecionadas e “Confira a seleção antes de preparar o arquivo”. Não conservar selo de conferido. |
| Preparando conferência | “Conferindo seleção e revisões…”; não dizer salvo nem pronto. |
| Conferido | Resumo de filial/período/revisões, pessoas/códigos incluídos, linhas por arquivo, pendências e validade; “Preparar arquivo de colaboradores (TXT1)” ou “Preparar definições de turnos (TXT2)”. |
| Atribuição persistindo | “Salvando atribuição…”; só resposta válida muda para “Atribuição salva · revisão N”. |
| Conflito/alterado | “O planejamento mudou. Atualize as referências e confira novamente”; preservar o rascunho conforme fluxo existente, sem reenviar automaticamente. |
| Expirado | “A conferência expirou. Conferir novamente”; retirar arquivos e aceite antigos. |
| Falha de arquivo | “O arquivo não foi confirmado. Tente preparar novamente”; sem URL para HTML/JSON vazio. |

Depois de erro de campo, foco no primeiro campo inválido; depois de erro de conferência, no resumo de problemas; ao fechar atribuição, retornar ao botão da pessoa ainda presente. Na conclusão, manter a pessoa identificada e anunciar a nova revisão. Reentrada não transfere seleção ou resultado do acesso anterior. Cor sozinha não indica bloqueio, pendência ou preservação. Não substituir nomes de ação por TXT1/TXT2: o formato é informação secundária.

## 8. Divisão futura de arquivos e dependências

Nenhuma distribuição ou implementação foi iniciada. A separação abaixo permite reservar os arquivos sem escritores concorrentes, depois de o Maestro fechar a revisão de autorização e aprovar o contrato proposto.

| Fatia | Arquivos mínimos / responsabilidade |
| --- | --- |
| Contrato de integração, escritor único antes dos demais | Novo `web/src/lib/escalas/shift-catalog/flow-contracts.ts` para opções contextuais e manifesto v2. Congelar os nomes/campos da seção 5 e exemplos positivo/vazio/pendência; não alterar `contracts.ts`, `types.ts` ou `access-contracts.ts` r3. |
| Backend F09 | Novo `web/src/app/api/escalas/turnos/opcoes/route.ts` e teste; implementação contextual em `shift-catalog/catalog.ts` ou helper específico. Reusar fonte de elegibilidade da troca, com o responsável pela autorização. `swap.ts` e `manual-override.ts` só mudam se a integração demonstrar lacuna, não para facilitar a UI. |
| Backend F10 | `turnos/export/manifest/route.ts`, `shift-catalog/export.ts`, payload em `catalog.ts`, download em `turnos/export/route.ts` e testes correspondentes. Preservar caminho legado e layouts de `domain.ts`; v2 calcula seleção exata, pendências completas, contagens e digest. Não exige migração para manifesto JSON. O escritor backend deve reservar `catalog.ts` para F09/F10 sequencialmente ou extrair o helper de manifesto em etapa própria; duas pessoas não editam esse arquivo ao mesmo tempo. |
| UI F09 | `shift-catalog/shift-swap.tsx`, `client.ts`; novo editor de cópia somente se necessário. Fonte liberada para edição local de definição: `configuration.tsx`, ainda não revisada nesta leitura. Usa GET opcoes e PREVIEW/APPLY atuais; não implementa autorização local. |
| UI F10 | `shift-catalog/turno-export.tsx` e helpers locais de filtros/seleção/prévia; usa `flow-contracts.ts`, mesmas escolhas de referência e paginação existente. `escalas-workspace.tsx` recebe uma mudança isolada de montagem para catálogo sem escala aberta. Reservar esse arquivo ao integrador; F09/F10 não o editam simultaneamente. `results.tsx` não precisa mudar. |
| Integração | Responsável único reconcilia contratos congelados, guardas do 02 e composição da UI; valida ADMIN e filial. Não usar mudanças na autorização como consequência de layout ou filtro. |

Para F10, UI pode ser implementada em paralelo com backend após congelar os DTOs propostos, com fixtures do contrato e sem apresentar entrega de arquivo até o endpoint aceitar seleção v2. F09 usa a rota contextual somente quando liberada; não faz fallback global se ela falhar. O ponto obrigatório de coordenação é o contrato, não um novo documento de capacidades paralelo ao r3.

## 9. Critérios de teste para a execução posterior

Os testes existentes foram lidos para identificar cobertura e contratos; **nenhum teste foi executado nesta tarefa**. Os nomes atuais cobrem alocação de códigos, concorrência de SYNC, isolamento, escolha explícita de referências, layouts, preservação de registros e conflito de troca. Há teste que exige omissões de não selecionados, razão adicional para preservar o caminho legado. A rota GET de download tem teste de negativas no snapshot; será necessário sucesso real do caminho novo, além da guarda final tratada pelo 02.

| Grupo | Casos de aceite obrigatórios |
| --- | --- |
| Regressão r3 | Corpos antigos ainda produzem as respostas/omissões antigas; SYNC não renumera códigos; layouts UTF-8/CRLF permanecem byte a byte. |
| Definição administrativa | Copiar definição usada não altera original, atribuições ou histórico; tupla existente reutiliza código; tupla nova recebe código novo; lote inicial indevido mostra erro real; filial não cria definição nem código. |
| Opções e atribuição | Sucesso com código existente permitido; contexto/revisão incompatível, código não liberado, sem aprovação e lista vazia; não há fallback. Confirmar troca preserva ausência/folga/feriado/bloqueio/outros funcionários, respeita datas e não muda 8h/9h. Grade ausente continua ausente. |
| Filtros | OR no setor A/B, AND com turno/pessoa/matrícula; exemplo Ana/setor B não combina vínculos de pessoas distintas. `0007` não vira `7`. Setor com mesmo texto em duas filiais mantém identidade composta. Matriz de cinco filtros em ambos os modos. |
| Seleção | Página 1 + página 2 preservam IDs e contagens; todos os resultados só após enumeração completa; mudança incompatível remove seleção e informa quantidade; resultado vazio e `members:[]`/`codes:[]` nunca viram tudo; IDs ocultos/adulterados não ampliam o conjunto. |
| Catálogo puro | Definição sem pessoa produz TXT2 positivo em ALL; filtro de uso sem vínculo produz zero, sem fallback. Filial é uso, não propriedade. Turno usado por pessoa sem matrícula pode gerar TXT2 de catálogo, mas não TXT1 daquela pessoa. |
| Pessoas e arquivos | Duas pessoas no mesmo código → duas linhas TXT1 e uma TXT2; escolha de duas entre três não omite a terceira no v2; null/sem matrícula gera pendência explícita; colisão de matrícula identifica todas e bloqueia; variantes não são achatadas. Conferir linhas/bytes, não apenas rótulos. |
| Limitações reais | Noturno, pausa remunerada, mais segmentos, horário parcial, quatro zeros, ID local obsoleto, matrícula inválida, origem incompleta, pessoa TIMED excluída e UNTIMED/MISSING. Não inventar marcação, férias ou presença. |
| Congelamento | Mudar revisão, fonte, referência, tupla selecionada, filtros, modo ou permissão invalida conferência/aceite; expiração impede download; TXT1/TXT2 complementares correspondem ao mesmo digest. Alteração não relacionada em catálogo não muda bytes da seleção imutável. |
| Assíncrono e arquivos | Clique duplo não duplica operação; deadline/cancelamento libera repetição; resposta antiga/401 tardio não altera novo contexto. HTTP 200 com JSON/HTML/vazio não gera link. Fluxo de erro mantém orientação e dados seguros. |
| Navegador real posterior | Administrador e filial, teclado, foco, 200% de zoom, tela estreita, nomes longos, muitas páginas, vazio e indisponível. Abrir os TXT e comparar conjunto/revisão/zeros/tuplas com a conferência. Sem usar um teste estático como prova de interação. |

## 10. Evidência da leitura, hashes e liberação

Foram inventariados 30 arquivos autorizados: catálogo/rotas/UI e seus testes, dois componentes integradores, contratos/tipos, schema, PRODUCT/DESIGN e critérios externos. Context Mode foi validado com análise útil: `ctx_batch_execute` indexou a coleta independente; `ctx_execute` leu UTF-8, extraiu os trechos/títulos de testes e calculou hashes. `ctx_search(sort:timeline)` não trouxe decisão adicional útil e não fundamentou o desenho. A edição deste documento usa patch nativo.

SHA256 do inventário inicial, ordenando pares caminho absoluto/hash e serializando em JSON: `ba72a7b641998b8d4a22114ac768f934bcd80541fd98d2925ffc2d929b43ad68`. A comparação intermediária encontrou zero mudanças. Depois disso, por solicitação do Maestro, **foi liberada explicitamente a leitura de `turnos/export/route.ts`, `route.test.ts`, `shift-catalog/export.ts` e `export.test.ts`** para a correção do 02. O Maestro informou que `export.test.ts` já recebeu alteração; os outros arquivos podem mudar durante a correção. Os hashes abaixo são apenas os observados antes dessa liberação; esses quatro arquivos não são relidos nem usados para afirmar estabilidade final. As mudanças previstas são guardas de exportação, incluindo a guarda final após os bytes, com preservação das entradas/saídas. Os demais 26 arquivos continuam sujeitos à conferência final desta entrega.

| Fonte (relativa ao checkout, salvo critérios) | SHA256 do snapshot lido |
| --- | --- |
| `web/src/lib/escalas/shift-catalog/contracts.ts` | `b744d2370a41a947ad1238bfcbef36382a2b8be7061b098ed442dcabf7aeca44` |
| `web/src/lib/escalas/shift-catalog/catalog.ts` | `35d345ee71a07458b189d7ad9a0c416339067276df8c2c6f22cb8adc92a878ab` |
| `web/src/lib/escalas/shift-catalog/domain.ts` | `61a1958e5225fa6c9aab05dcc6a7d3514214a95eca19e6a9ee8942a91213aca5` |
| `web/src/lib/escalas/shift-catalog/export.ts` — liberado | `7cc792eaa5cabb7d8df370bab7539ddef91aa07ce54acdb1cbebb558a648a7b8` |
| `web/src/lib/escalas/shift-catalog/swap.ts` | `6c7f01925e79b87e9e95cbcef18669766aaa762377f95f6f8ca55fcddef31589` |
| `web/src/lib/escalas/shift-catalog/reference-choices.ts` | `162961f913658d6cd3126f61362456e6637481740cd2079c196d6a62c5372e3e` |
| `web/src/lib/escalas/shift-catalog/manual-override.ts` | `3c20e8135386c844236864766ecdd01622a62fca8895c55257ca2032925ed1e3` |
| `web/src/app/api/escalas/turnos/route.ts` | `f235b02d5a76c9bf333f713cb724f021ace752ae0069cbb587593fab8ce0610b` |
| `web/src/app/api/escalas/turnos/export/manifest/route.ts` | `03611d251c8fdbc9bad95395005ebad25b4eb95072986e0da8105389f783015d` |
| `web/src/app/api/escalas/turnos/export/route.ts` — liberado | `c372c95a8eb40bfe046acf11d9e7ed89c68109dddc14aa47b3a48663bce5e153` |
| `web/src/components/escalas/shift-catalog/client.ts` | `6995306e8f955086cb4714dcc4ce318205e362a5aa7158ee9668f8c178bc23b0` |
| `web/src/components/escalas/shift-catalog/shift-swap.tsx` | `658fde743d2048c72906ac1163c787d58b66d571d5d898d4f7de2dcbf2b66791` |
| `web/src/components/escalas/shift-catalog/turno-export.tsx` | `c4f252339a5355ddbb39a3639b9050fbb47805b429ac3c6cfed956940a35ab6b` |
| `web/src/components/escalas/escalas-workspace.tsx` | `aa3a04bce5b5835f9a59baa63fad89353c41e77dda1909b698535b67c0be4717` |
| `web/src/lib/escalas/access-contracts.ts` | `c00eab12193033610979c4274e07e0f673aa42e31d38fc8b9693d92a24be02f0` |
| `web/src/lib/escalas/types.ts` | `c49982f886402fc55a65592657def80866c0fe0733463e5c942116ad049e454b` |
| `web/prisma/schema.prisma` | `44b1c2101d203ff393ba32ed7e8032a7c724ed674b1eddd9015de5ab843ccbfc` |
| `PRODUCT.md` | `27bca4ea7013a099bddaa815c7681944e8cd67f263326dd42e1d45b3733e8d3b` |
| `DESIGN.md` | `74b0c5bf60b0508d0117309463f212fa1bda32bad25130e98e22632c45e40fe3` |
| Critérios externos indicados no início | `7742d9bda7807d5c292440d497e1085b8e36fdb73e04c2da1f12129b992f26e1` |

Conferência final: 26 fontes não liberadas permaneceram iguais ao inventário inicial; os quatro arquivos cedidos ao 02 foram excluídos da releitura. A conferência de espaços do documento não apontou problemas. O estado Git deste arquivo é novo/não rastreado, sem commit.

Não houve teste, navegador, servidor, Solver, quality/build, instalação, banco, migração, commit, push, deploy, mensagem lateral ou subagente. Nenhum descartável ou processo foi criado; não há temporário próprio a concluir. Não falta entrada indispensável para este desenho; a futura edição do formulário de definição exige liberar `configuration.tsx`, conforme seção 3. Ao entregar o documento, ficam liberadas as leituras restantes desta reserva; não haverá acompanhamento contínuo.
