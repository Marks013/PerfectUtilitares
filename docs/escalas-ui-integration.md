# Integração da nova interface de Escalas

Data: 13/11/2026, America/Sao_Paulo.
Tarefa: AUX-ROLE-UI-INTEGRATION r1.
Despacho: `AUX-ROLE-UI-INTEGRATION:r1:batch104`.
Gate104: `b51991dd701ca9eebc8c09196aa897f27a5ecfca3ddcae3c4a9ec210f583151a`.

## Resultado e alcance

As correções foram implementadas no clone `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`, sobre HEAD `8651e77b108cd3026d50707dea60c03963c9faaf`, preservando as alterações anteriores e das outras frentes. Foram alterados/adicionados 28 arquivos de componentes, hooks, clientes HTTP e testes; este documento é a única escrita adicional da fatia.

O percurso novo usa nome cadastrado, configuração aprovada, modelo administrativo e aplicação assinada. Foram corrigidos os bloqueios operacionais identificados em F01–F08, além de nomenclatura, acessibilidade e tratamento assíncrono no recorte de F11–F14. A interface está implementada contra os contratos liberados; isso não comprova que o backend em integração, o banco existente ou produção já estejam prontos.

**Limite mantido:** somente o administrador configura e permite a distribuição de 8h/9h e cria/altera definições de horários/turnos. A filial pode atribuir horários existentes e permitidos, gerar/recalcular, editar dias autorizados e cadastrar por modelo aprovado. Não foram modificados Solver, regras de cálculo, contratos públicos, backend, schema, migrações, segredos ou arquivos de outras frentes. Não houve commit, push, deploy ou operação com dados reais.

## Entregas por fluxo

| Fluxo / achado | Correção implementada | Evidência principal |
| --- | --- | --- |
| F01 — entrada | Formulário de nome cadastrado, texto sobre navegação sem identidade forte, reentrada/expiração e erro; resposta de conta administrativa conserva precedência. Não usa senha compartilhada. | operational-access.tsx; operational-client.ts; operational-client.test.ts; role-integration.test.tsx |
| F02 — nova grade operacional | Consulta configuração pelo período técnico exato; escolhe versão ativa; CREATE_APPROVED envia somente o ID da aprovação. Distingue consulta, falha e ausência de aprovação, com nova consulta explícita. | approved-forms.tsx; use-escalas-workspace.ts |
| F03 — novo colaborador | Formulário disponível inclusive com equipe vazia, com nome, matrícula e modelo da aprovação vinculada. ADD_EMPLOYEE usa CAS; não cria ID, vínculo, contrato, regime ou marcações no navegador. Matrícula duplicada é indicada junto do campo. | approved-forms.tsx; use-escalas-workspace.ts; operational-client.test.ts |
| Administração | Consulta/cadastro/edição de operadores, filiais e capacidades explícitas; situação ativa, encerramento de sessões e modo de entrada. Edição de perfil e grants não se descartam silenciosamente; troca de operador/consulta é bloqueada enquanto há edição, com descarte explícito disponível. | operator-administration.tsx |
| Aprovação administrativa | Exemplar e rótulo de modelos selecionados explicitamente; opção separada para dados iniciais de afastamento/feriado; conferência da revisão; APPROVE, REVOKE e vínculo explícito via ADMIN_REBASE. Vincular recebe a nova revisão do servidor; não substitui localmente a edição por uma seed. | approval-administration.tsx; use-escalas-workspace.ts |
| Proposta e salvamento | proposalProof permanece junto da candidata e sai do estado quando a candidata é descartada/substituída. Quando há prova, APPLY_PROPOSAL envia conteúdo, assinatura, ID e revisão, sem misturar com SAVE manual. Aplicação operacional sem prova é recusada. O fluxo administrativo legado sem prova foi preservado. | mass-generation.ts; use-escalas-workspace.ts |
| F04 — análises gerenciais | Proposals e ValidationResults conferem report.analytics; aba/conteúdo de desfalques deixam de aparecer ao operador mesmo entrando nos descendentes. Roster não calcula/apresenta as faixas gerenciais sem essa capacidade. Erros/avisos operacionais e prévia de impacto permanecem. | results.tsx; roster.tsx; access-context.test.tsx |
| F05 — navegação | Troca de planejamento intercepta candidata pendente mesmo sem dirty. Usuário pode continuar conferindo ou descartá-la explicitamente. Havendo edição e candidata, “Salvar rascunho, descartar candidata e abrir” descreve a consequência; salvar não aplica. | workspace-navigation.ts; use-escalas-workspace.ts; escalas-workspace.tsx |
| F06/F07 — distribuição e turnos | Resumo somente leitura de 8h/9h e setores; horários uniformes têm ajuda distinta. HoursProposal e definição manual ficam administrativos. Atribuição usa canAssign do contrato e não autoriza definição. Shifts também se protege no próprio componente. | escalas-workspace.tsx; configuration.tsx; role-integration.test.tsx |
| F08 — estados e recuperação | Carregando, erro e vazio têm textos distintos; aprovação ausente/revogada não é apresentada como outra aba. Proposta inválida orienta nova geração; contexto desconhecido não ganha autoridade por fallback. | escalas-workspace.tsx; workspace-feedback-model.ts |
| F11 — nomes | Aplicar proposta à grade é usado nos dois pontos. Publicar continua separado de salvar. Arquivos deixam explícito que filtros visuais não recortam o documento. | publication.tsx |
| F12 — respostas e arquivos | TXT aborta/invalida requisições quando o contexto muda/desmonta; callbacks antigos não publicam manifesto/arquivo no estado novo. MIME text/plain e corpo não vazio são exigidos para TXT. PDF/XLSX mantêm formato, revisão e blob conferidos, sem habilitar link em erro. | shift-catalog/client.ts; shift-catalog/turno-export.tsx; publication.tsx |
| F13 — erro de horário | Parser de formulário identifica período/campo incompleto, fim anterior e sobreposição; erro associado ao início/fim e foco no primeiro erro. Mantém HH:MM estendido após meia-noite e pausas remuneradas/não remuneradas. Field associa ajuda ao controle e preserva descrição de erro existente. | shift-editor-validation.ts; configuration.tsx; controls.tsx |
| F14 — teclado e tela pequena | Controles/tokens/CSS existentes preservados. Foco após erro, ajuda associada e navegação por botões nativos foram conferidos no recorte sintético; não foi criado um sistema visual paralelo. | controls.tsx; escalas-workspace.tsx; prévia sintética descrita abaixo |

Os caminhos abreviados da tabela pertencem a `web/src/components/escalas/`.

## Semântica preservada

- 4h30 é equilíbrio de dois períodos de trabalho na proposta automática, mantendo jornada diária e duração do intervalo; não é teto diário.
- A opção de pausa curta se aplica somente à simulação de trabalho **acima de 4h e até 6h**, sem os 15 minutos. Exatamente 4h não entra na dispensa; jornadas acima de 6h mantêm a regra de refeição.
- Administrador configura/autoriza 8h/9h e setores. Operador não recebe controles para ativar, desativar ou redefinir essa distribuição.
- Criar/alterar definição de turno é administrativo; atribuir existente não gera código ou marcação implicitamente.
- Referência sem grade não equivale a presença real nem cobertura garantida. Não se inventam horas, vínculo ou histórico.
- Geração produz candidata; aplicação muda a grade; gravação depende de confirmação; publicação registra aprovação interna separada.

## Contratos consumidos e preservados

| Arquivo | SHA-256 conferido antes e depois |
| --- | --- |
| web/src/lib/escalas/access-contracts.ts | `c00eab12193033610979c4274e07e0f673aa42e31d38fc8b9693d92a24be02f0` |
| docs/escalas-access-api-contract.md | `ae54c287a05859ada188806d706e5deaa7311d7c08a6bb6cc0ac983ce1c4c38f` |

Nenhum endpoint foi inventado. Nome, contexto visual e capability no cliente não substituem a autorização do servidor. Os novos comandos seguem os DTOs liberados; a configuração integral não é exposta ao formulário operacional.

## Verificação executada

| Verificação | Resultado e limite |
| --- | --- |
| Vitest de toda a pasta de componentes de Escalas, 40 arquivos / 293 casos naquele momento | 290 passaram inicialmente; três expectativas de contexto/texto falharam. As duas suítes afetadas foram corrigidas e verificadas: 31 testes aprovados. Os testes de análise agora fornecem contexto administrativo explícito; não foi restaurada permissão por ausência de contexto. |
| Execução dirigida posterior, sete arquivos | 58 testes aprovados: papéis, recuperação, comandos HTTP, revisão/arquivos, leitura de horário e proteção de navegação. Inclui quatro casos novos de role-integration. |
| Após a última alteração de administração/recuperação, dois arquivos pertinentes | 15 testes aprovados. Não foram repetidas suítes que não dependiam dessa alteração. |
| Biome, fatia de componentes com alterações locais | 46 arquivos conferidos, sem avisos/erros no nível exigido, sem correções automáticas. |
| git diff --check no ownership de componentes | Aprovado. |
| Bundle sintético dos componentes com esbuild | Aprovado; valida sintaxe e resolução para a prévia, não substitui TypeScript global nem build de produção. |
| Chrome instalado, Playwright, interceptação integral em https://ui.test | Cenários abaixo aprovados, em dois contextos isolados: operador e administrador. Nenhuma requisição foi enviada ao servidor/banco real. |

A prévia montou os componentes React e o hook reais, com dados sintéticos e respostas HTTP interceptadas. Usou CSS Modules reais e uma base visual mínima para a página de teste; não representa a aplicação completa com todas as camadas de CSS. Não é E2E de produção.

Cenários efetivamente executados por clique/preenchimento:

1. Entrada por nome e contexto operacional; comando sem password.
2. Consulta de aprovação e CREATE_APPROVED sem input livre.
3. ADD_EMPLOYEE por modelo, preservando matrícula textual e sem IDs/vínculos inventados.
4. Resumo administrativo de 8h/9h somente leitura na filial.
5. Geração candidata e troca de período interceptada; continuar mantém a candidata.
6. Aplicação assinada envia proposalProof e CAS e só confirma após a resposta.
7. Rejeição de aplicação por aprovação revogada mantém candidata/grade e foca a orientação.
8. PDF com MIME errado e depois corpo vazio não libera download; nova tentativa com resposta sintética não vazia libera o link. O conteúdo sintético não foi apresentado como um PDF real validado.
9. Descartar candidata explicitamente permite abrir outro período.
10. Revisão operacional sem aba gerencial de desfalques.
11. Cadastro/edição administrativa de operador, atualização de filiais/capacidades, encerramento de sessões e mudança de modo com CAS. Os cliques também conferiram bloqueio cruzado entre perfil e grants para não descartar edição aberta; nenhuma chave local foi enviada no JSON.
12. Aprovação de configuração/modelos, ADMIN_REBASE explícito e revogação da versão selecionada, sem copiar seed localmente.
13. Viewport 390×844 sem overflow horizontal global no cenário sintético; captura inspecionada. Isso não comprova todos os tamanhos, zoom 200%, contraste dos temas reais, leitor de tela ou todos os gestos.

A prévia inicial exigiu duas correções do próprio harness: origem HTTPS para crypto.randomUUID e expiração sintética dentro de uma hora, evitando o limite de setTimeout para datas muito distantes. Esses incidentes não foram registrados como defeitos de produção. A execução final completou os cenários e fechou os contextos/Chrome; nenhum erro de runtime React foi observado.

Não foram executados quality, build ou typecheck globais, conforme a coordenação enquanto backend e PDF estão em edição. Nenhum teste recebeu acesso a segredos ou dados reais.

## Aplicação contextual das skills

- UI/UX Pro Max: rótulos nativos, estados de consulta/erro/vazio, ajuda associada, foco após falha e verificação em largura estreita.
- Impeccable: clareza de efeito/alcance; edição e candidata não são descartadas em silêncio; cada bloqueio explica a ação necessária, sem confirmação cerimonial em todos os cliques.
- Frontend Design: composição pelos controles, tokens e tarefas existentes; nenhuma fonte, pacote ou ornamento novo.

As instruções já tinham sido lidas nesta sessão, incluindo craft-floor antes das alterações. Context Mode foi usado de fato para coleta, análise, agregação dos testes/lint e hashes; apply_patch nativo para edições. Não houve delegação nem mensagens laterais.

## Pendências e próxima integração

- F09/F10 completos continuam na tarefa AUX-SHIFT-CATALOG-INTEGRATION: catálogo independente, filtros combinados, seleção entre páginas e exportação do mesmo conjunto conferido. Esta fatia **não** acrescentou filtros visuais que insinuem um recorte do arquivo.
- Foi lido o critério futuro em `C:/Users/samue/Desktop/PerfectUtilitares/outputs/apoio-maestro-20261113/criterios-interface-turnos.md`. O TXT existente recebeu proteção de requisição/arquivo e nome explícito de cadastro global, sem alegar que a integração futura está pronta.
- Enforcement do backend novo, transações/concorrência no PostgreSQL existente, revogação real de sessões, modelo aprovado real e geração/assinatura reais exigem validação integrada pelo Maestro.
- Relatório gerencial final da outra frente e seus bytes PDF devem ser integrados e verificados separadamente. Não foram reescritos aqui.
- Typecheck/quality/build integrados e smoke autenticado/operacional no ambiente autorizado permanecem para a etapa coordenada. A prévia sintética não libera produção.
- F14 permanece parcialmente aberto para a aplicação completa: teclado em todos os formulários, 200% de zoom, leitores de tela, temas/contraste, tabelas longas e dispositivos reais. Não há certificação global de acessibilidade.

## Arquivos desta entrega e SHA-256

Prefixo dos arquivos abaixo: `web/src/components/escalas/`. Os hashes fixam a entrega sobre o estado compartilhado local, sem incluir alterações de backend.

| Arquivo | SHA-256 |
| --- | --- |
| approved-forms.tsx | `7545daf692223a5c944dfb2f48d76e32304219d395f2c90f44e204030d751da6` |
| approval-administration.tsx | `c09fe35a1c25f20c945f0154c1446fa1a0927f27ae225a7845fe568ccf5e461b` |
| operator-administration.tsx | `63999fd85e7d7cdebb75e5f491d35ec95a4c98a8d710ea2cd3262da225e34354` |
| operational-client.ts | `58710ffa67991913294252b429f002231a5a4eeb06a00c12b136f72a21131eb7` |
| operational-client.test.ts | `9ef76986b768dfbe17ebfcd9d45f15026e2ddc9d72f0847dd95763558c4c5855` |
| role-integration.test.tsx | `fae7b3d5b4ff5dcc644668be59b0fdd0243810032a6610a7edc0c02717906c99` |
| workspace-navigation.ts | `62ceec541637d825554e2dccedd38ff7cefc5a4938f810b1244134bb782a68ab` |
| workspace-navigation.test.ts | `6befac649a6b5381ceebb727c7145833ef76e8fe449155a1ce300addd875c8ab` |
| shift-editor-validation.ts | `0f13ff8611149c3841704500dd3eeb9774f3af59f1b471eb7cf56f591eb79737` |
| shift-editor-validation.test.ts | `9b283a286368da0ebf09d58788e78de658695e06811cb70b1f1c991d16fbf9a2` |
| operational-access.tsx | `eee75b9f22e42ccba1a1ffc765247b81a14398b809fde0a9ff59b0d60c5eeab8` |
| use-escalas-workspace.ts | `9674ad78fcf35afc82b903f631bdf3bd812d4c0e6f6b2006413b77c09dd9f23a` |
| escalas-workspace.tsx | `ff6a5851ea2960cfc91d4128e96d3c9c540b6607be6d93c06e015ea79775788d` |
| mass-generation.ts | `baea015e761511327fef02d37d710dca28025554ddbd53f7a259e1c40277343e` |
| results.tsx | `3d2bdbdb0f743d23cb604707460a52727fbe04711f79c446135082196e17cecd` |
| roster.tsx | `8bc54e4f72c0702706eabca19335d27a4a5d7756b404f0627023cb0646f45b44` |
| controls.tsx | `688e8e70185e235e5ddb498c58d07e02c2a75d6263611b02dc5237bbfead7330` |
| configuration.tsx | `cd690faf85472fe16f3201ecbb92d28b99b9b41bd18f5830aa0e46bfeb23005d` |
| publication.tsx | `723a5a6d6ce17687fc1c8099c8fb51ec610dd6953e7ff23b9144c2f1efc45f57` |
| shift-catalog/client.ts | `6995306e8f955086cb4714dcc4ce318205e362a5aa7158ee9668f8c178bc23b0` |
| shift-catalog/turno-export.tsx | `c4f252339a5355ddbb39a3639b9050fbb47805b429ac3c6cfed956940a35ab6b` |
| workspace-feedback-model.ts | `18ae396f31bb78964753fa093fd10579d374ecdea3cc3054f59c9d3a89e32bff` |
| workspace-feedback-model.test.ts | `80485ceaff20886c0179619dad756216824ccb37d726e086ff78e5fb35f39828` |
| access-context.test.tsx | `0066f000d3fd4360bbd00fe01c46783aefac65b916f2f8c1f17461472ee62d91` |
| workspace-view.test.tsx | `7870d10062545c217dbfd4fe21a8ae0c7c69f82977e2414a51bbb6594c095733` |
| results-insights.test.tsx | `f90bb49bed99b871dd8d71c012cc76a9d900463f2080b4c5755bb5affa2014c5` |
| shortage-order.test.tsx | `7ead8446d10398703e54c4190e4fbb4a9d5c965901788f49c778ebf6899deaa7` |
| weekly-capacity.test.tsx | `8087b073afaf83ac6f454cdda8de56dc240be388cb948c28c9263c0e4c002957` |

## Encerramento

Sem processos ou temporários necessários para continuidade. Os descartáveis da prévia pertencem somente à pasta temporária criada por esta frente e podem ser concluídos após a verificação. Documentos anteriores e evidências de outras frentes foram preservados. Recursos do ownership de UI liberados com esta entrega; nenhum release ou acionamento de produção foi realizado.
