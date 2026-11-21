# Auditoria de linguagem e fluxos de Escalas

Data: 13/11/2026. Despacho: `AUX-PLAIN-LANGUAGE:r1:batch62`; gate62 `d8a6d569320fea84c88c46869cb8f8f60a2b1cc41900abe3e2f955e15bd0f929`; reserva63.

## Escopo e fonte

Documento de recomendações para o executor da interface. Única escrita desta frente: este arquivo. Contexto de público e objetivos: `PRODUCT.md` atual do clone. Componentes e bibliotecas foram consultados exclusivamente por `git show c10602c246f3ec7a5f4bf64ae805cddf3cb960ce:<path>`. Todos os caminhos e números de linha abaixo se referem a essa base imutável, antiga em relação à integração posterior; não descrevem os arquivos em edição nem a produção atual. Reconciliar nomes, ações e semântica com o commit consolidado posterior do Maestro Central antes de aplicar.

Preservar o sistema visual existente, as regras e as permissões. As políticas em integração não comprovam autorização ativa no servidor. Este documento descreve comportamento do produto, sem acrescentar aconselhamento legal. P0 significa risco direto de decisão incorreta; P1, ambiguidade de tarefa ou alcance; P2, consistência e orientação.

## Textos críticos para incorporação prioritária

### L01 — Dois períodos de trabalho, não um teto diário — P0

- **Arquivo/ponto:** `web/src/components/escalas/hours-proposal.tsx:14–24`, `ContinuousWorkOption`; implementação em `web/src/lib/escalas/preparation.ts:151–205`.
- **Título atual:** “Limitar cada bloco a 4h30”.
- **Título proposto:** “Equilibrar os dois períodos de trabalho em até 4h30 cada”.
- **Ajuda curta:** “Ajusta a divisão antes e depois do intervalo, mantendo o total diário e a duração do intervalo. Horários bloqueados são preservados.”
- **Semântica comprovada:** a preferência atua nas propostas automáticas com dois segmentos WORK separados por BREAK contíguo. Redistribui os segmentos quando algum supera 270 minutos; não reduz o total de minutos trabalhados. A rotina não produz esse ajuste para alvo acima de 540 minutos. Não é um limite geral aplicado a qualquer tipo de jornada. O componente avisa quando uma decisão bloqueada foi mantida.
- **Aceitação:** em uma proposta elegível com 5h + intervalo + 3h, a opção permite redistribuir para 4h30 + o mesmo intervalo + 3h30. A pessoa deve entender que continua com 8h de trabalho no dia. Um dia bloqueado permanece preservado com explicação; não prometer que todo horário cadastrado será alterado.

### L02 — Pausa curta: acima de 4h e até 6h, somente em simulação — P0

- **Arquivo/ponto:** `web/src/components/escalas/labor-policy-fields.tsx:15–38`, `ShortMealSimulation`; `web/src/lib/escalas/labor-rules.ts:12–16`; `web/src/lib/escalas/validation-time.ts:67–68`.
- **Título atual:** grupo “Intervalos de jornadas curtas”; opção “Simular jornadas de 4 a 6 horas sem pausa”.
- **Título proposto:** grupo “Pausa curta na simulação”; opção “Simular jornada acima de 4h e até 6h sem pausa de 15 min”.
- **Ajuda curta:** “Somente neste cenário de simulação. Jornadas acima de 4h e até 6h podem ser testadas sem os 15 minutos de pausa. Acima de 6h, a regra de refeição permanece. Gere outra proposta após mudar a opção.”
- **Aviso preservado:** “Esta simulação não autoriza dispensar pausas no trabalho real.”
- **Semântica comprovada:** até 240 minutos, `minimumMealMinutes` retorna zero independentemente dessa opção. Acima de 240 e até 360, retorna 15, exceto quando `simulation` e `allowShortMealSimulation` estão ativos. Acima de 360, retorna `policy.minMealMinutes`. O controle ativa `simulation: true`, marca necessidade de nova geração quando existe grade e mantém a pendência específica de validação.
- **Aceitação:** conferir os limites 240, 241, 360 e 361 minutos de trabalho, excluindo BREAK do total. Exatamente 4h não deve aparecer como beneficiada pela dispensa; 4h01 e 6h podem usar a opção apenas na simulação; 6h01 mantém a regra de refeição. Não remover avisos nem transformar a opção em liberação operacional.

## Auditoria complementar

### L03 — Gerar e recalcular produzem uma candidata — P0

- **Arquivo/ponto:** `web/src/components/escalas/escalas-workspace.tsx:209`; `use-escalas-workspace.ts:328–364`; `results.tsx:222–229`.
- **Título atual:** “Gerar nova proposta”, com variantes conforme o modo; resultado “Proposta pronta para revisão”.
- **Título proposto:** manter “Gerar nova proposta” e usar “Proposta para conferir — ainda não aplicada” no resultado. Evitar introduzir “Recalcular” como sinônimo sem explicar o resultado.
- **Ajuda curta:** “Primeiro salvamos as alterações. Depois calculamos uma proposta para você conferir. A grade muda quando você aplicar a proposta.”
- **Semântica comprovada:** a geração aguarda `flushDraft`, executa a análise e guarda o resultado em `generated`; aplicar usa `generated.proposalInput`. Uma nova tentativa não é, por si só, aplicação ou publicação.
- **Aceitação:** após gerar, distinguir a candidata da grade anterior; ao falhar ou cancelar, não anunciar grade atualizada. Não prometer que nenhuma preparação interna será salva durante a geração.

### L04 — Um nome para aplicar a candidata — P0

- **Arquivo/ponto:** `results.tsx:229`, `publication.tsx:83–85`, `use-escalas-workspace.ts:354–364`, todos em `web/src/components/escalas/`.
- **Título atual:** “Aplicar proposta à grade” e “Usar proposta na grade”.
- **Título proposto:** “Aplicar proposta à grade” nos dois pontos.
- **Ajuda curta:** “Substitui a grade atual pela proposta conferida. O rascunho será salvo automaticamente. Isso não publica a revisão.”
- **Semântica comprovada:** ambos recebem a ação de aplicação da candidata; o hook atualiza o rascunho e a fila de salvamento, sem chamar `PUBLISH`.
- **Aceitação:** o mesmo verbo identifica o mesmo efeito. Renderizar a proposta ou pedir um arquivo não pode aplicar a candidata silenciosamente. Manter bloqueio de candidata inválida.

### L05 — Salvar não significa aprovar — P0

- **Arquivo/ponto:** `escalas-workspace.tsx:208`, `publication.tsx:82,96–100`, `use-escalas-workspace.ts:354–364`, em `web/src/components/escalas/`.
- **Título atual:** “Salvar agora”, “Tentar salvar”; mensagem sobre salvamento automático.
- **Título proposto:** manter as ações; padronizar estados em “Alterações aguardando salvamento”, “Salvando alterações”, “Revisão {n} salva” e “Salvamento não confirmado”.
- **Ajuda curta:** “Salvar guarda suas alterações neste planejamento. A aprovação interna é uma ação separada.”
- **Semântica comprovada:** edição e aplicação passam pela fila de salvamento; publicação exige outra ação e revisão estável. O texto de sucesso deve acompanhar a resposta confirmada, sem antecipá-la.
- **Aceitação:** em falha de gravação, manter as alterações e a ação de recuperação existente; nunca mostrar “salvo” apenas porque a edição entrou na fila.

### L06 — Publicação da revisão, não da candidata — P0

- **Arquivo/ponto:** `web/src/components/escalas/publication.tsx:100`; `use-escalas-workspace.ts:396–409`.
- **Título atual:** grupo “Aprovação interna (opcional)”; botão “Publicar proposta”.
- **Título proposto:** manter o grupo; botão “Publicar revisão conferida”.
- **Ajuda curta:** “Registra a aprovação interna desta revisão salva. Não envia mensagens nem lançamentos em folha.”
- **Semântica comprovada:** `PUBLISH` envia ID e revisão esperada do workspace, exige `canPublish`, ausência de edição pendente e validação pronta. Não publica diretamente `generated`. A conferência perde validade se revisão/conteúdo mudam.
- **Aceitação:** após editar ou trocar de revisão, não reaproveitar a conferência anterior. Manter a confirmação existente da revisão, sem adicionar confirmação a toda navegação ou edição comum.

### L07 — Arquivos usam a grade atual salva — P0

- **Arquivo/ponto:** `web/src/components/escalas/publication.tsx:43–71,81–96`; `escalas-workspace.tsx:247`.
- **Título atual:** “Arquivos do planejamento”; “Gerar PDF”, “Gerar XLSX”.
- **Título proposto:** “Arquivos da grade atual”; no modo sem grade, “Arquivos dos horários de referência”.
- **Ajuda curta:** “Filial {filial} · período {período} · revisão {n}. Há uma proposta não aplicada? Aplique-a primeiro se quiser seus dados no arquivo.”
- **Semântica comprovada:** a geração do arquivo aguarda o salvamento e usa ID/revisão retornados, modo e separação por setor. A validade do download considera identidade, revisão, modo, alterações e estado desatualizado.
- **Aceitação:** com candidata pendente, permitir exportação da grade anterior quando válida, identificando-a claramente; não bloquear por uma candidata apenas por existir, nem chamar esse arquivo de resultado da candidata. Mudança durante o download exige gerar novamente.

### L08 — Referências sem grade não são presenças — P0

- **Arquivo/ponto:** `web/src/components/escalas/hours-reference-preview.tsx:9–19`; `generation-mode-option.tsx:27–28`.
- **Título atual:** “Referências de horários”; “Só horários”.
- **Título proposto:** quando não há grade, “Horários de referência — sem dias definidos”; ação “Gerar horários de referência”.
- **Ajuda curta:** “Confira os horários. Nenhum dia de trabalho ou folga foi criado; ainda não há cobertura diária.”
- **Semântica comprovada:** o preview apresenta grupos de referências, sem células de calendário nem afirmação de cobertura. Com grade existente, HOURS_ONLY preserva situações dos dias e ajusta horários.
- **Aceitação:** os dois contextos de HOURS_ONLY precisam de ajuda distinta. Sem grade, não anunciar “escala pronta”, não preencher presença e não oferecer análises que dependam de dias trabalhados.

### L09 — “Só folgas” ainda pode distribuir durações — P0

- **Arquivo/ponto:** `web/src/components/escalas/generation-mode-option.tsx:20–31`.
- **Título atual:** “Só folgas”.
- **Título proposto:** “Planejar folgas com os horários definidos”.
- **Ajuda curta:** “Usa as referências ajustadas à jornada escolhida, sem otimizar entradas e saídas. Se o administrador autorizou a distribuição de 8h/9h, ela continua sendo considerada. Dias bloqueados são preservados.”
- **Semântica comprovada:** a ajuda da base já informa que REST_ONLY reutiliza referências ajustadas e pode distribuir dias de 8h e 9h. O rótulo isolado pode induzir a acreditar que nenhuma duração diária mudará.
- **Aceitação:** usuário entende a consequência antes de gerar. Operador não recebe um atalho para autorizar ou configurar a distribuição; usa somente a configuração administrativa permitida. Essa exigência de permissão é requisito atual do usuário e precisa ser reconciliada com a integração, não está comprovada como ativa pela base.

### L10 — Distribuição semanal de 42h é configuração administrativa — P0

- **Arquivo/ponto:** `web/src/components/escalas/mixed-42-option.tsx:26–30`; `configuration.tsx:46`; `web/src/lib/escalas/labor-rules.ts:46–65`; `validation-employee.ts:172`; `web/src/components/escalas/workspace-model.ts:192–198`.
- **Título atual:** “Jornada mista de 42h (opcional)”; “Setores que usarão jornada mista”.
- **Título proposto (administrador):** “Distribuição de 42h: dias de 8h e 9h”; campo “Setores autorizados para esta distribuição”. Para o operador, resumo informativo “Distribuição semanal definida pelo administrador”.
- **Ajuda curta:** “Em uma semana completa elegível de 42h: três dias de 8h e dois de 9h. O horário de 9h inclui intervalo não trabalhado de 3h. Sem essa distribuição, o modelo uniforme usa 8h24 por dia.”
- **Semântica comprovada:** a regra é limitada a referências elegíveis de 42h e setores selecionados, não a todas as pessoas ou semanas. Sem grade, prepara duas durações, sem comprovar a distribuição semanal. A validação trata semanas com afastamento ou feriado fechado de forma específica. A seleção ativa simulação e necessidade de nova geração quando existe grade.
- **Decisão expressa do usuário:** distribuir dias de 8h/9h deve ser configurado e permitido pelo administrador. Operador não ativa, desativa, escolhe setores nem altera parâmetros protegidos; pode gerar/recalcular usando a distribuição administrativa autorizada. Ocultar ou tornar informativo o controle no perfil operacional não substitui autorização no servidor. Não afirmar que essa proteção já está implementada.
- **Aceitação:** administrador configura e autoriza; operador vê o efeito autorizado e sua explicação, sem controle de mudança. Tentativa direta de alteração sem permissão precisa ser rejeitada pela integração autorizadora. Em semana parcial e em referência sem grade, não prometer três dias de 8h e dois de 9h já distribuídos. Preservar simulação, validações e bloqueios.

### L11 — Ajuste manual de entrada/saída altera o rascunho — P1

- **Arquivo/ponto:** `web/src/components/escalas/hours-proposal.tsx:86–105`.
- **Título atual:** “Horários para {n}h · conferir ou ajustar manualmente”; “Ajustar horários no rascunho”.
- **Título proposto:** “Conferir e ajustar os horários de referência”; manter o botão explícito existente.
- **Ajuda curta:** “Escolha se deseja manter a entrada ou a saída. O ajuste entra no rascunho; confira as exceções e gere outra proposta.”
- **Semântica comprovada:** `adaptCompatibleSchedules` entrega um novo input ao `onChange` e lista exceções. Não é apenas uma visualização. O caminho uniforme manual não se oferece quando há setores em distribuição mista.
- **Aceitação:** mudar o seletor não deve ser anunciado como ajuste concluído; só a ação executada gera o retorno. Não orientar o operador a desmarcar setores protegidos para contornar a configuração administrativa.

### L12 — Horário do colaborador e catálogo da empresa têm alcances distintos — P0

- **Arquivo/ponto:** `web/src/components/escalas/shift-catalog/shift-swap.tsx:58–100`; `web/src/lib/escalas/shift-catalog/swap.ts:33–45,63–121,155`.
- **Título atual:** “Trocar turno · {nome}”; “Buscar no catálogo da empresa”.
- **Título proposto:** “Alterar o horário de {nome} neste planejamento”; busca “Escolher um horário do catálogo da empresa”.
- **Ajuda curta:** “A troca vale para este colaborador, nesta filial e no período escolhido. Confira os dias afetados e preservados antes de aplicar.”
- **Semântica comprovada:** PREVIEW_SWAP e APPLY_SWAP identificam workspace, revisão, colaborador e datas; o catálogo fornece o horário escolhido. A troca não é edição global da definição do catálogo. Preserva folgas, afastamentos, feriados, bloqueios e ajustes manuais conforme os motivos apresentados.
- **Aceitação:** trocar o horário de uma pessoa não é entendido como troca para todos. Não prometer alterar todos os dias do intervalo: a prévia informa os dias preservados. Manter a revisão esperada e a validade da prévia.

### L13 — Datas da mudança e alcance visível — P1

- **Arquivo/ponto:** `web/src/components/escalas/shift-catalog/shift-swap.tsx:15–21,90–100`; `web/src/lib/escalas/shift-catalog/swap.ts:33–45`.
- **Título atual:** “Vigência inicial”, “Vigência final”; “Conferir troca”; “Confirmar troca de turno”.
- **Título proposto:** “Aplicar a partir de”, “Aplicar até”; “Conferir alteração”; “Aplicar horário neste período”.
- **Ajuda curta:** “De {início} a {fim}, para {nome}, na filial {filial}. A mudança fica neste planejamento.”
- **Semântica comprovada:** a solicitação leva datas inicial e final, limitadas ao planejamento; alterar seleção ou data invalida a prévia. Sem grade, muda referência sem criar trabalho ou folga.
- **Aceitação:** testar um intervalo interno ao mês e conferir ambas as fronteiras, dias fora dele e motivos de preservação. Não confundir essas datas com admissão/fim do vínculo do cadastro. Não criar alcance “todos os planejamentos”, inexistente nesta ação.

### L14 — Cadastrar no catálogo é uma ação global distinta — P0

- **Arquivo/ponto:** `web/src/components/escalas/shift-catalog/turno-export.tsx:110–125,157–179`.
- **Título atual:** “Cadastrar turnos necessários”; confirmação “Confirmo o cadastro das referências sem código no catálogo da empresa.”
- **Título proposto:** “Cadastrar horários selecionados no catálogo da empresa”.
- **Ajuda curta:** “Cadastra as referências selecionadas que ainda não têm código no catálogo compartilhado da empresa. Confira a lista antes de continuar.”
- **Semântica comprovada:** SYNC reúne referências selecionadas por workspace/revisão para cadastramento no catálogo; não é apenas baixar arquivo. A escolha de referência para TXT, por sua vez, não modifica a grade.
- **Aceitação:** preservar a confirmação existente dessa escrita global, evitar chamá-la de simples “sincronizar” ou “continuar”. Conforme PRODUCT.md, importação e TXT são administrativos; não afirmar proteção ativa sem verificar a integração final.

### L15 — Preferência, regra fixa e folga na grade — P0

- **Arquivo/ponto:** `web/src/components/escalas/employees.tsx:290–329,419–425`; `web/src/lib/escalas/validation-employee.ts:92`; `web/src/components/escalas/roster-editor.tsx:60–69`.
- **Título atual:** “Dias fixos aprovados”; “Preferências de folga (não são bloqueios)”; situação “Folga”.
- **Título proposto:** “Dias da semana com folga fixa”; “Dias preferidos para folga — sem garantia”; manter “Folga” na célula do dia.
- **Ajuda curta:** “Preferência orienta a proposta. Folga fixa é uma regra do colaborador. A grade mostra o que foi definido para cada data.”
- **Semântica comprovada:** trabalhar em `fixedOffDays` gera ocorrência FIXED_OFF; preferências são um campo separado. A situação OFF é uma decisão diária. Preservar a qualificação de aprovação quando exigida pela regra existente; não fazer o novo rótulo conceder autoridade.
- **Aceitação:** selecionar domingo como preferido não é exibido como domingo já folgado. Configuração fixa e dias OFF permanecem distinguíveis; não inferir aplicação na grade a partir do cadastro.

### L16 — Jornada diária e decisão preservada na geração — P1

- **Arquivo/ponto:** `web/src/components/escalas/roster-editor.tsx:15–26,31–69`.
- **Título atual:** “Turno autorizado”; “Preservar esta decisão nas próximas gerações”; “Confirmar alteração”.
- **Título proposto:** “Horário deste dia”; manter a explicação de preservação; botão “Aplicar alteração neste dia”.
- **Ajuda curta:** “Vale para {nome} em {data}. Se a decisão ficar preservada, novas gerações não a substituirão.”
- **Semântica comprovada:** o editor produz uma assignment para um colaborador e uma data, limitada aos horários permitidos; o campo locked preserva a decisão. O código confere impactos antes de aplicar e mantém conflitos em rascunho quando permitido.
- **Aceitação:** não confundir editar uma célula com mudar referência para o mês. Manter “Aplicar com conflitos ao rascunho” quando houver conflitos e as restrições de desbloqueio; não transformar esse estado em aprovação operacional.

### L17 — Grade desatualizada e gravação pendente não são o mesmo problema — P0

- **Arquivo/ponto:** `web/src/components/escalas/publication.tsx:94–96`; `workspace-feedback-model.ts:24–29`; `escalas-workspace.tsx:178–180`.
- **Título atual:** “A grade está desatualizada”; “Desatualizado — gere novamente”; “Este planejamento foi atualizado em outra aba.”
- **Título proposto:** para regra/equipe alterada, “A grade precisa de uma nova proposta”; para arquivo antigo, “Arquivo de uma versão anterior”; para conflito, manter a descrição de atualização em outra aba.
- **Ajuda curta:** grade: “Gere uma proposta com os dados atuais e aplique após conferir.” Arquivo: “Gere o arquivo da revisão atual.” Conflito: “Compare as versões antes de escolher qual manter.”
- **Semântica comprovada:** `outdated`, validade de arquivo e conflito de revisão têm condições e recuperações diferentes. O produto também distingue gravação incerta de falha definitiva.
- **Aceitação:** tentar salvar não é apresentado como solução universal para grade que precisa de geração. Não sugerir recarregar ou descartar automaticamente uma edição/candidata pendente. Preservar comparação e recuperação existentes.

### L18 — Arquivos básicos, relatório gerencial e integração — P1

- **Arquivo/ponto:** `web/src/components/escalas/publication.tsx:81–100`; `operational-reports.tsx:64–78`; `shift-catalog/turno-export.tsx:157–179`; separação por perfil em `PRODUCT.md`.
- **Título atual:** “Arquivos do planejamento”; “Relatórios e gráficos PDF”; “Exportar turnos TXT da empresa”.
- **Título proposto:** “Baixar folgas e horários” para os arquivos básicos, contextualizando conteúdo pelo modo; “Relatório gerencial em PDF” para análises administrativas; “Arquivos TXT de integração” para integração administrativa.
- **Ajuda curta:** básico: “Escolha PDF ou XLSX da revisão atual.” Gerencial: “Escolha as seções e os setores deste relatório.” TXT: “Confira as referências e os códigos do catálogo antes de gerar.”
- **Semântica comprovada:** os três fluxos usam contratos e ações distintos. O relatório opcional gera somente PDF; as escolhas de suas seções não alteram a escala. PRODUCT.md reserva TXT e análises gerenciais ao administrador e permite PDF/XLSX básicos conforme escopo.
- **Aceitação:** operador não precisa entrar em relatório gerencial ou TXT para obter seus arquivos básicos. Não colocar Capacidade/Desfalques em XLSX, nem tratar a ausência desses dados como defeito. Autorização no servidor deve ser verificada na integração posterior.

### L19 — Variantes e cobertura precisam dizer o que representam — P1

- **Arquivo/ponto:** `web/src/lib/escalas/operational-report-contracts.ts:6–17,75–92`; `web/src/components/escalas/operational-reports.tsx:65–78`.
- **Título atual:** “Catálogo de variantes”, “Cobertura por faixa”; modelo “Conferir um dia”.
- **Título proposto:** “Variações de horários deste planejamento”; “Pessoas previstas por faixa de horário”. Manter “Conferir um dia”.
- **Ajuda curta:** “O mapa diário exige uma data. Sem grade, estão disponíveis apenas horários e suas variações.”
- **Semântica comprovada:** variantes são uma seção de documento, não uma ação para cadastrar no catálogo global. Sem grade, o contrato permite somente journeys/variants; com grade, permite as seis seções. Presence exige data, coverage permite seleção sem data. Nenhuma dessas seções comprova presença real.
- **Aceitação:** distinguir planejamento de registro real de ponto. Não chamar referências de presença nem resumo de cobertura de necessidade total de contratação. Reconciliar os DTOs posteriores de Capacidade/Desfalques sem reinterpretá-los nesta frente.

### L20 — Entrada da tarefa e navegação administrativa — P1

- **Arquivo/ponto:** `web/src/components/escalas/escalas-workspace.tsx:38–46,195–196`; contexto de perfis em `PRODUCT.md`.
- **Título atual:** “Importar equipe”, “Escolher jornada e gerar”, “Revisar e exportar”; ferramentas “Cobertura”, “Revisão e suporte”, “Ajustes”.
- **Título proposto:** “Equipe”, “Preparar proposta”, “Grade e arquivos”; manter ferramentas próximas à tarefa correspondente com nomes específicos do conteúdo, sem trocar tudo por “Avançado”.
- **Ajuda curta:** “Confira a equipe, prepare uma proposta e revise a grade antes de baixar os arquivos.”
- **Semântica comprovada:** são áreas do mesmo planejamento; a troca de área não deve ser tratada como conclusão de cálculo, aplicação ou aprovação. Importação é somente uma das ações da área de equipe e permanece administrativa pelo brief.
- **Aceitação:** filial/período/salvamento ficam visíveis em todas as áreas. Perfil operacional não recebe uma primeira etapa obrigatória chamada “Importar” quando essa ação é administrativa. Administrador encontra importação na tarefa de equipe e análises junto da revisão, sem percorrer painéis desconexos.

## Fluxo orientado a tarefa para incorporação pelo executor

Esta é organização das capacidades existentes, não criação de funções ou redesenho do sistema visual.

1. **Escolher o planejamento:** apresentar filial, período e revisão. Se houver edição pendente, preservar a escolha existente entre salvar/abrir e continuar; não descartar silenciosamente.
2. **Conferir a equipe:** mostrar incluídos, excluídos, referências ausentes e regras de folga como conceitos separados. Importação e configurações protegidas ficam no percurso administrativo.
3. **Preparar proposta:** explicar o resultado escolhido — folgas e horários, folgas com referências, ou horários. Mostrar a distribuição semanal administrativa em uso. Configuração de 8h/9h, setores e opções protegidas pertence ao administrador; gerar não concede essa autoridade.
4. **Conferir a candidata:** apresentar comparação e ação explícita “Aplicar proposta à grade”. Referências sem grade recebem seu estado próprio. Sem modal adicional para cada clique.
5. **Revisar a grade:** editar um dia ou trocar a referência de um colaborador com alcance/data visíveis. Reutilizar prévia de impacto, preservação e confirmação somente onde já há substituição relevante.
6. **Obter o documento:** área básica mostra conteúdo e revisão do PDF/XLSX. Administrador pode seguir para relatório gerencial ou TXT, identificados separadamente e sem alterar a grade ao escolher seções/referências.
7. **Aprovar internamente, quando pertinente:** ação separada, com permissão e conferência da revisão. Salvar, gerar, aplicar e baixar não publicam.

Exibir no máximo uma ação primária pertinente à situação, mantendo as ações secundárias disponíveis no contexto. Não esconder erros, estados de simulação ou consequências para simplificar visualmente. A recomendação é reorganizar controles existentes; qualquer mudança de comportamento exige a revisão técnica da integração.

## Vocabulário consistente

| Termo | Significado no produto | Evitar como sinônimo |
| --- | --- | --- |
| Planejamento | Trabalho da filial e do período selecionados | Catálogo global |
| Proposta | Resultado candidato que ainda precisa ser aplicado | Grade atual ou revisão publicada |
| Grade | Decisões por pessoa e data | Lista de referências |
| Horário de referência | Horário disponível para propor/selecionar | Dia trabalhado ou presença real |
| Revisão salva | Conteúdo confirmado pelo servidor | Alterações na fila de salvamento |
| Aplicar | Substituir/alterar o rascunho no alcance informado | Publicar |
| Publicar | Registrar aprovação interna da revisão | Salvar ou enviar à folha |
| Catálogo da empresa | Cadastro compartilhado de horários com códigos | Variações no relatório |
| Folga preferida | Preferência para o cálculo | Folga garantida |
| Folga fixa | Regra cadastrada do colaborador | OFF já aplicado em uma data |
| Jornada diária | Tempo de trabalho do dia, sem intervalo não trabalhado | Permanência total entre entrada e saída |

## Reconciliação e verificação

- As três referências solicitadas foram lidas: UI/UX Pro Max, Impeccable e Frontend Design. Aplicação limitada à clareza, consequência e organização do produto existente; nenhuma proposta de troca de fontes, cores ou componentes. O carregamento de contexto do Impeccable leu PRODUCT.md e informou ausência de DESIGN.md/brief; isso não foi tratado como autorização para criar um novo sistema visual.
- `ctx_execute` foi usado com sucesso para ler a árvore e os blobs imutáveis, selecionar pontos e conferir semântica; `ctx_search` foi usado para os trechos indexados de pausa e blocos. Nenhuma leitura direta de componentes/bibliotecas concorrentes, execução de servidor, renderização, teste, Solver, banco, quality, build, commit ou deploy foi necessária para esta entrega documental.
- O status inicial confirmou branch `codex/escalas-permissoes-isoladas`, HEAD `c10602c246f3ec7a5f4bf64ae805cddf3cb960ce` e alterações alheias já presentes. Elas foram preservadas. Nenhum descartável ou processo próprio foi criado.
- As aceitações acima são critérios propostos, não testes executados. Não houve avaliação visual, por teclado, em tela pequena ou com usuário de filial. O documento não certifica cobertura integral de todas as telas do produto; cobre os pontos de erro real solicitados e seus caminhos adjacentes.
- Antes de incorporar, o executor deve reconciliar cada ação/linha com seu snapshot atual e o commit posterior do Central, eliminar recomendações já atendidas e preservar os contratos novos. Em especial, não considerar políticas candidatas da biblioteca como autorização ativa.
- **Decisão recebida durante a auditoria:** configuração e permissão para distribuir dias de 8h/9h são do administrador. Propagar essa exigência ao fluxo operacional e à verificação de servidor da frente responsável; esta auditoria não alterou a interface nem a política.
- Entrega documental concluída. Ownership e reserva desta frente podem ser liberados após o recebimento; não há tarefa de produção retomada ou processo/arquivo temporário dependente.
