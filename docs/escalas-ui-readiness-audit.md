# Auditoria de prontidão e crítica da interface de Escalas

Data: 13/11/2026, fuso America/Sao_Paulo. Responsável: esta frente de UI.

## Identidade, recorte e conclusão

Entrega `AUX-UI-READINESS r2`, despacho `AUX-UI-READINESS:r2:human-critical-review`. Substitui `r1:batch96`, cujo gate96 foi `1a32aa0ae607ae22a1dd04d7860fb849a5e80f273552cb121f79bbbd670cdf17`. A revisão continuou no mesmo recorte, sem reinício nem redistribuição.

Clone: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`. HEAD observado: `8651e77b108cd3026d50707dea60c03963c9faaf`, com mudanças locais preservadas. As conclusões referem-se aos bytes locais inventariados, não apenas ao commit e não à produção. Única escrita desta frente: este documento.

Contexto lido: `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `docs/escalas-language-audit.md` e `docs/escalas-base-reconciliation.md`. A auditoria de linguagem usa uma base anterior; suas recomendações foram confrontadas com a UI atual, sem tratá-las automaticamente como pendências ainda abertas.

**Conclusão:** a interface possui estrutura específica do produto e mecanismos de preservação importantes, mas o percurso operacional novo está incompleto. Não está pronta para ser declarado funcional de ponta a ponta. Entrada por nome, criação operacional com configuração aprovada e cadastro por modelo ainda não têm percurso completo na UI examinada. Existe exposição de análises em componentes compartilhados sem a condição de perfil aplicada aos menus externos. A candidata pode desaparecer ao trocar de planejamento sem edição pendente. Filtros novos e integração catálogo → atribuição → conferência → exportação permanecem trabalho futuro.

Não houve navegador, execução de testes, build, quality, typecheck, Solver, SAVE/APPLY/PUBLISH, servidor, banco ou deploy. Testes existentes foram lidos, não executados. Backend/APIs, page.tsx, access-contracts.ts, contratos em revisão e implementações de relatório de outras frentes não foram lidos. O aviso de contrato backend revisado não foi tratado como integração da UI já concluída.

## Critérios realmente aplicados

As três skills solicitadas estavam disponíveis e foram lidas nesta sessão. A auditoria aplicou seus critérios à operação de filiais leigas e à administração existente; a invocação de uma skill não é certificação de qualidade.

| Referência local | Critério aplicado | Evidência e consequência |
| --- | --- | --- |
| `C:/Users/samue/.agents/skills/ui-ux-pro-max/SKILL.md` e `references/quick-reference.md` | Rótulos associados, feedback próximo ao erro, alvo de toque, foco não encoberto, navegação previsível, estados vazios | `controls.tsx:18–25` associa label; falta associação da ajuda. CSS possui controles de 2,75rem e foco explícito; foco sob cabeçalhos sticky exige navegador. Estados iniciais e filtros foram conferidos em F08/F09. |
| `C:/Users/samue/.agents/skills/impeccable/SKILL.md`, `reference/clarify.md`, `operate.md`, `audit.md` | Uma ação deve explicar efeito, alcance, momento e recuperação; usar padrões familiares no modo Operate; separar achado determinístico de hipótese visual | Diferença gerar/aplicar/salvar/publicar, candidata não salva, edição diária versus referência, fluxo sem configuração aprovada e mensagens de erro foram rastreados nos handlers. Ver F01–F13. O carregador de contexto já havia sido executado nesta sessão; PRODUCT e DESIGN atuais foram relidos diretamente nesta revisão. |
| `C:/Users/samue/.codex/skills/frontend-design/SKILL.md` | Coerência de controles, semântica real, execução adequada ao produto e contenção visual | `DESIGN.md:3–15`, `escalas.module.css:3–78`, tabelas e controles nativos. Não propomos fontes, paleta nova, efeitos, landing page nem cartões decorativos. A preservação explícita do sistema existente prevalece sobre sugestões estéticas gerais da skill. |

Não foi executado script Python, instalador ou detector com runtime. Esta fatia documental não autoriza iniciar o app, produzir artefatos adicionais ou examinar arquivos concorrentes. Não há nota numérica de acessibilidade/saúde visual: faltam contraste medido, teclado, leitor de tela, zoom e renderização para sustentar a pontuação. Não se declara WCAG atendida nem violada por suposição.

Context Mode usado de fato: `ctx_execute` validou leitura/análise útil, capturou hashes e examinou fontes/testes permitidos; `ctx_batch_execute` indexou a auditoria anterior e os testes adjacentes; `ctx_search(sort: "timeline")` recuperou o despacho e a decisão sobre 8h/9h. A saída PowerShell 5.1 da coleta documental mostrou caracteres mal decodificados; as fontes de análise foram lidas por Node com UTF-8. Isso não foi classificado como corrupção dos arquivos.

## Como interpretar as classificações

- **Implementado em fonte:** há controles e handlers para o caminho descrito. Não significa validação funcional nesta execução.
- **Robustez parcial demonstrável:** existem guardas e testes específicos de falha/concorrência no código. Não significa interface inteira robusta nem testes aprovados agora.
- **Incompleto:** o requisito vigente não possui percurso completo neste conjunto de UI.
- **Defeito comprovado em fonte:** há condição/ação concreta contraditória, com cenário derivável do código; nenhuma reprodução em navegador é alegada.
- **Risco:** consequência depende de integração, dados, permissão ou runtime ainda não validado.
- **Ausência de teste localizado:** a cobertura não foi encontrada no conjunto adjacente examinado; não significa inexistência em todo o repositório.
- **Genérico:** empregado somente para mensagem/rótulo que não explica esta tarefa concreta, nunca como julgamento global da aparência.

Prioridades: P1 antes de liberar o percurso operacional; P2 na próxima integração ou melhoria contextual. Nenhum P0 de produção foi comprovado por esta auditoria de fonte.

## Inventário dos fluxos e evidência de prontidão

Caminhos abreviados nesta seção são relativos a `web/src/components/escalas/`; hashes completos no inventário ao final. “T” remete à seção de testes.

| Fluxo/pessoa | Estado observável em fonte e evidência | Teste existente e alcance real | Pendência, prioridade e aceite objetivo |
| --- | --- | --- | --- |
| Entrada / operador e administrador | Boundary recebe contexto, mantém conteúdo oculto/inert enquanto bloqueado e oferece recuperação de foco. A interface ainda mostra o campo de senha, conforme `operational-access.tsx:48–89`; `access-context.tsx:17–23`. **Incompleto** para nome. | T01 propaga contexto e restringe controles por render estático; não envia formulário nem expira sessão real. | F01, P1, UI + contrato. Nome válido deve abrir só filiais concedidas, sem dar administração; expiração e reentrada devem preservar rascunho. Nome continua separação de navegação aceita, sem alegação de identidade forte. |
| Escolher filial/período / ambos | Seletores hierárquicos usam somente períodos existentes e mantêm contexto: `plan-selector.tsx:14–89`; filtragem visual em `escalas-workspace.tsx:105–107,179–203`. **Implementado**, com proteção parcial. | T02 verifica seleção pura, múltiplos planejamentos e markup; T03 verifica preservação da fila. Não prova interação com backend. | F05/F08, P1/P2. Candidata e edições devem ter destino explícito ao trocar; carregamento, lista vazia e ausência de acesso devem ser diferentes. |
| Nova grade / administrador | Formulário filial/mês cria input e chama CREATE: `escalas-workspace.tsx:50–77`; `use-escalas-workspace.ts:277–289`. **Implementado em fonte** no percurso administrativo. | T04 verifica formulário aberto, rótulos e ausência de opções avançadas; não cria planejamento real. | UI + backend, P1 para integração. Administrador cria filial/período correto com dados preservados; duplicação e erros devem ter retorno do contrato final. |
| Nova grade / operador | Capacidade workspace.create é reconhecida, mas somente administrador recebe formulário; operador lê que precisa de configuração: `escalas-workspace.tsx:107,182`. **Incompleto**. | T01:66–76 confirma justamente ausência do formulário e texto de bloqueio, não a criação operacional aprovada. | F02, P1. Com configuração aprovada, operador deve poder iniciar o período autorizado; sem aprovação ou revogada, explicar a dependência sem oferecer alteração de regra. |
| Editar horário/folga em um dia / operador | Editor mostra data/pessoa, prévia de impacto, proteção de afastamento/feriado/bloqueio e opções de horários existentes: `roster-editor.tsx:32–81`; `roster.tsx:139–190`. **Implementado**, robustez parcial. | T05 testa modelos puros para bloqueios, ausências, troca e undo; T01 verifica controles protegidos por markup. Não confirma salvar clicando. | UI + backend, P1 de integração. Editar dia permitido salva só alcance autorizado; dia protegido permanece; horários não cadastrados não são criados por esta ação. HOURS_ONLY usa percurso de referências, sem edição de folga. |
| Gerar/recalcular / operador | Botão depende de schedule.generate, equipe incluída e modelo; prepara candidata: `escalas-workspace.tsx:213–235`; `use-escalas-workspace.ts:327–351`. **Implementado em fonte**. | T06 usa transporte simulado para sequência de revisão, falha e cancelamento; T07 verifica opções/semântica de modos. | Backend + runtime, P1. Configuração administrativa deve permanecer; sucesso apresenta candidata e falha não inventa resultado. Não confundir validade com qualidade/otimalidade. |
| Aplicar proposta / operador | `results.tsx:220–229` bloqueia inválida; `use-escalas-workspace.ts:354–364` coloca candidata no rascunho e na fila. **Implementado**, com nomenclatura duplicada. | T08:319–355 verifica indicação da revisão, botão inválido e ausência de aplicação ao renderizar. | F05/F11, P1/P2. Aplicação explícita, estado de salvamento posterior e nenhum PUBLISH implícito; usar o mesmo verbo nos dois pontos. |
| Salvar rascunho / ambos | Fila, atraso, backup de sessão, confirmação e conflito estão separados: `use-escalas-workspace.ts:69–106,233–264`; `draft-persistence.ts`. **Robustez parcial demonstrável**. | T03 realmente exercita fila com promessas/erros simulados; inclui confirmação perdida e resposta antiga. Não grava banco nem valida novas permissões. | Runtime + backend, P1 de integração. Revisão confirmada e conteúdo digitado durante save sobrevivem; revogação não leva a retry infinito nem sobrescrita. |
| Publicar / administrador autorizado | `publication.tsx:28–35,49,104` exige capacidade e conferência da revisão; hook usa PUBLISH separado em `use-escalas-workspace.ts:396–409`. **Implementado em fonte**. | T09 verifica identidade/conteúdo/revisão da conferência; T01 prova ocultação para operador por markup. | Backend + runtime, P1. Editar invalida a conferência; operador não publica; a aprovação não envia folha/mensagem. |
| Cadastro de colaborador / ambos | Admin edita campos e valida duplicidade; operador edita nome/preferências, mas “Adicionar” está desabilitado sem settings.manage: `employees.tsx:163–208,528–550`. **Cadastro operacional por modelo incompleto**. | T08 verifica formas de cadastro; T01:78–86 verifica formulário limitado, sem submissão. | F03, P1, UI + contrato/modelos. Modelo aprovado permite criação sem expor jornada/regras livres; ausência de modelo identifica a ação administrativa necessária. |
| Selecionar/atribuir horário existente / operador | Troca pesquisa catálogo, exige prévia/revisão/datas e mostra preservados: `shift-catalog/shift-swap.tsx:28–100`; acionamento `escalas-workspace.tsx:254–255`. **Implementado em fonte**, integração parcial. | Não foi localizado teste adjacente que importe ShiftSwap e execute busca/atribuição. T05 cobre modelo de troca de dias, que é outra operação. | F07/F12, P1/P2. Separar atribuição de definição de turno no contrato liberado; conferir revisão, fronteiras e resposta atrasada. REST_ONLY hoje não oferece o botão de troca; preservar/explicar essa escolha até a integração aprovada. |
| Criar/alterar definição de horário e catálogo / administrador | Shifts edita definições locais sob settings.manage: `configuration.tsx:106–126,230–284`; `escalas-workspace.tsx:285–294`. Cadastro global de referências fica dentro do TXT. **Fragmentado/incompleto** como percurso administrativo integrado. | T08/T10 verificam opções e horários; não foi localizado teste adjacente de CRUD global/cadastro por catálogo. | F07/F10, P1/P2. Administração define; filial atribui existente. Não declarar entregue a próxima integração catálogo → atribuição → conferência → exportação. |
| PDF/XLSX básicos / operador | Formatos por concessão, contexto de revisão, guarda de resposta/formato/blob, aviso de candidata e link pronto: `publication.tsx:28–104`. **Implementado**, robustez parcial. | T01/T08 verificam estados estáticos, formatos independentes e botões; não fazem fetch/download/abrem bytes. | F09/F12, P2 + runtime P1. Arquivo corresponde à filial/revisão/conteúdo declarado; nenhum XLSX traz Capacidade/Desfalques; filtros de tela não devem insinuar recorte exportado inexistente. |
| TXT / administrador | Seleção por filial/mês, referências múltiplas, manifesto, omissões, confirmação de cadastro e download: `shift-catalog/turno-export.tsx:67–181`; acesso externo em `escalas-workspace.tsx:294`. **Implementado em fonte**, disperso. | Nenhum teste adjacente localizado importa TurnoExport. Ausência de cobertura aqui não invalida eventual E2E externo não examinado. | F10/F12, P2; integração catálogo pendente. Contagens e omissões devem corresponder ao manifesto, sem cadastro implícito nem seleção oculta entre filiais/páginas. |
| Relatório gerencial / administrador | Área própria com report.analytics; presets, setores, data e identidade/abort: `escalas-workspace.tsx:209–212`; `operational-reports.tsx:9–81`. **UI presente; integração do novo relatório incompleta**. | Nenhum teste adjacente localizado importa OperationalReports. Não foram lidos testes/backend do chat02. | UI + contrato/backend relatório, P1 de integração. Opções válidas por dado disponível, estados sem grade, erros e PDF real devem ser conferidos depois da entrega do chat02. |
| Configurações / administrador | Jornada semanal, 8h/9h, 4h30 e pausa curta estão sob manageSettings: `escalas-workspace.tsx:217–233,285–294`. **Separação visual implementada**, enforcement não auditado. | T01 oculta opções para operador; T07/T10 conferem texto/estado e funções puras, não proteção de API. | F06/F07, P1/P2. Somente administrador configura/permite 8h/9h e definições; operador entende configuração aprovada sem ganhar seus controles. |
| Filtros/seleções combinados / ambos | Já há filial/ano/mês, busca de nome/matrícula/cargo, setor e paginação da grade; busca da equipe e do catálogo são isoladas: `plan-selector.tsx:62–89`, `roster.tsx:46–54,86–95,173–183`, `employees.tsx:514–560`. **Parcial**. | T02 prova seletores existentes. Não há evidência adjacente de novos filtros combinados, limpar ou seleção entre páginas. | F09, P2, próxima tarefa. Filial/colaborador/setor/turno/matrícula e integração de seleção/exportação não estão entregues. |

## Crítica priorizada e propostas pequenas

### F01 — P1 — Entrada ainda representa o acesso anterior

**Pessoa/cenário:** operador chega para escolher seu nome, mas encontra “Senha operacional” e mensagem de acesso compartilhado. Em erro de sessão, PDF e feedback também pedem senha.

**Prova estável:** `operational-access.tsx:48–58,78–87`, `publication.tsx:67`, `workspace-feedback-model.ts:23`. A fonte envia password e exige resposta com role OPERATIONAL; não há campo de nome nesse formulário. É **incompletude comprovada em fonte** em relação ao requisito atual; não é conclusão sobre rotas em revisão.

**Ajuste:** integrar a entrada e a reentrada ao contrato liberado, atualizar mensagens do mesmo canal e manter o caminho administrativo existente. Explicar que nome seleciona navegação e escopo, sem prometer identificação forte.

**Aceite/dependência:** UI + contrato/backend. Nome autorizado recebe somente contexto permitido; inválido, expirado e revogado têm mensagem e retorno possível. Nenhum POST real foi executado para afirmar compatibilidade.

### F02 — P1 — Permissão de iniciar existe, mas a UI não oferece caminho aprovado

**Pessoa/cenário:** operador autorizado para workspace.create, com configuração aprovada da filial, quer iniciar um mês. Só vê “A configuração deste período precisa ser preparada pelo administrador”.

**Prova:** `escalas-workspace.tsx:107,182`; CreatePlan também barra não administrador em 63. T01 confirma esse bloqueio. A UI não consulta/seleciona snapshot aprovado nesta ação. **Incompletude comprovada**, não sugestão para abrir regras livres.

**Ajuste:** após contrato, reutilizar o formulário simples de período/filial permitida com resumo da configuração aprovada. Estado sem aprovação informa o que o administrador precisa preparar; revogação invalida a tentativa e mantém a seleção.

**Aceite/dependência:** UI + contrato/backend/dado aprovado. Mesma filial/mês autorizados criam sem editar policy; sem aprovação, nenhuma criação e nenhum botão sem explicação. Custo moderado de integração; não criar um assistente ou motor de aprovação paralelo.

### F03 — P1 — Cadastro por modelo aprovado ainda não é operável

**Pessoa/cenário:** filial precisa incluir uma pessoa por modelo já autorizado. “Adicionar colaborador” exige administrative e não há escolha de modelo. Com equipe vazia, o próprio componente Employees nem é montado.

**Prova:** `employees.tsx:528–550`, `escalas-workspace.tsx:250–256`; editor operacional em `employees.tsx:192–207` apenas devolve nome e preferredOffDays. **Incompletude comprovada**. Não atribuir ao teste de formulário limitado uma criação que ele não exerce.

**Ajuste:** caminho de inclusão por modelo aprovado, inclusive equipe vazia, com campos cadastrais permitidos e resumo do horário/regras herdados. Manter editor administrativo integral.

**Aceite/dependência:** UI + contrato/backend/modelo. Criar por modelo ativo funciona; modelo ausente/revogado explica a pendência e impede envio; campos de regra não são editáveis pela filial. Não inventar matrícula ou vínculo na UI.

### F04 — P1 — Análises administrativas continuam alcançáveis em componentes compartilhados

**Pessoa/cenário:** operador abre resultado ou “Avisos e orientações”. Embora o menu de relatório gerencial esteja oculto, pode receber “Conferir capacidade e desfalques por setor” ou aba “Desfalques”.

**Prova:** `escalas-workspace.tsx:264,274–275` monta Proposals/ValidationResults sem contexto de permissão de análise; `results.tsx:226` renderiza CoverageGaps na candidata; `results.tsx:249–260` sempre inclui aba coverage e pode selecioná-la automaticamente. `roster.tsx:99–100,185` também apresenta faixas de cobertura sem guarda local. **Defeito de composição visual comprovado em fonte**. Não se afirma vazamento de dados de outra filial nem bypass de API.

**Ajuste:** separar avisos operacionais indispensáveis de análise gerencial e aplicar o contexto de capacidade em todas as entradas dessas análises. Reusar a política visual existente, sem retirar erros que impedem a tarefa nem atribuir poderes ao frontend.

**Aceite/dependência:** UI + definição de projeção contratual/backend. Operador navega de verdade por equipe, candidata, grade e revisão sem capacidade/desfalques gerenciais; administrador mantém as análises. T01 precisa cobrir áreas visitadas e descendentes, não só HTML inicial. Preservar validações de conflito.

### F05 — P1 — Trocar de filial/período pode descartar candidata sem aviso

**Pessoa/cenário:** cálculo acabou; candidata aguarda aplicação e dirty é false. Usuário troca de mês para consultar algo e volta: a candidata foi apagada.

**Prova:** `use-escalas-workspace.ts:221–229` só intercepta open quando dirty; `acceptWorkspace:141–156` zera generated. O cálculo põe resultado em generated em 344 sem aplicá-lo. A grade salva não é perdida; o resultado candidato é transitório e pode ser perdido sem escolha. **Defeito de prevenção de erro comprovado em fonte**.

**Ajuste:** reconhecer candidata pendente ao abrir outro planejamento. Oferecer continuar conferindo ou descartar candidata e abrir. Não usar “Salvar e abrir” para sugerir que salvar rascunho aplica a proposta. Manter os três caminhos existentes para edições dirty.

**Aceite/dependência:** UI, custo pequeno. Dirty, candidata isolada, candidata+dirty e ausência de ambos têm consequências corretas; navegar sem trabalho pendente não cria confirmação extra. Teste deve exercer o handler, não apenas localizar os botões.

### F06 — P2 — Operador não vê claramente qual distribuição administrativa está em uso

**Pessoa/cenário:** administrador autorizou distribuição de 8h/9h; filial vê jornada semanal de 42h e ajuda do modelo uniforme de 8h24. O ajuste de referências também orienta desmarcar setores, controle ao qual o operador não tem acesso.

**Prova:** `escalas-workspace.tsx:217–235` oculta configuração mista e mantém ajuda do modelo uniforme; `hours-proposal.tsx:95–101` exibe instrução de desmarcar setores no contexto misto. **Orientação insuficiente comprovada**, não afirmação de cálculo errado.

**Ajuste:** resumo somente leitura da distribuição administrativa efetiva e dos setores aplicáveis; texto de encaminhamento ao administrador quando preciso, sem oferecer ativação/desativação operacional.

**Aceite/dependência:** UI + configuração aprovada do servidor. Operador identifica uniforme versus 8h/9h, não altera a configuração, e entende que referência sem grade ainda não distribuiu dias. Manter 3h de intervalo no exemplo de 9h e travas de simulação.

### F07 — P1 de integração — Atribuir existente e definir horário ainda dividem um nome de capacidade

**Pessoa/cenário:** requisito novo permite à filial atribuir um horário existente e reserva criar/alterar definições ao administrador. A UI usa shift.manage para troca do catálogo e ajuste de referências.

**Prova:** `permissions.ts:4–7` inclui shift.manage no conjunto operacional; `escalas-workspace.tsx:235,254` usa a mesma capacidade em HoursProposal e no acionamento de ShiftSwap. Shifts com criação manual está sob settings.manage em 285–290. **Ambiguidade de contrato/integração**, não prova de que o operador cria definição global.

**Ajuste:** consumir a distinção do contrato liberado: atribuição existente habilita escolha e prévia; definição administrativa habilita editor/cadastro apropriados. Geração/recalculo continuam podendo produzir propostas autorizadas, sem serem confundidos com edição livre de catálogo.

**Aceite/dependência:** contrato + backend + UI. Matriz positiva/negativa para atribuir, criar e alterar; tentativa direta não concede o poder administrativo. Não renomear enum localmente nesta auditoria nem inventar um segundo sistema de permissões.

### F08 — P2 — Vazio, carregamento e falta de aprovação compartilham orientação

**Pessoa/cenário:** primeira abertura ainda carrega a lista, mas a área de seleção já informa que não há escala e pede liberação ao administrador. Em falta de aprovação, o retorno genérico pode apenas mandar conferir equipe.

**Prova:** hook inicia workspaces=[] e busy="Carregando planejamentos…" em `use-escalas-workspace.ts:36–43`; `escalas-workspace.tsx:181` escolhe mensagem pelo tamanho de allowedPlans/canCreate sem excluir busy. O status de carregamento existe em outro local, logo não é ausência total de feedback. `workspace-feedback-model.ts:25,28,40` tem retornos amplos para permissão/configuração/desconhecido. **Mensagem prematura comprovada**; recuperação de aprovação ausente/revogada é **risco dependente do contrato**.

**Ajuste:** mensagem de carregamento no próprio seletor; após resposta, distinguir nenhum período, nenhuma filial concedida, configuração aprovada ausente e falha. Usar razões do contrato, sem inferir por lista vazia.

**Aceite/dependência:** UI + contrato para motivos novos. Em resposta lenta não pedir autorização prematuramente; em rejeição preservar rascunho e indicar responsável/ação possível. Não criar botão para operador editar configuração protegida.

### F09 — P2 — Filtros existentes não formam o fluxo combinado solicitado

**Pessoa/cenário:** usuário filtra setor e matrícula, muda página e quer limpar/baixar apenas encontrados; a busca de equipe, a grade, o catálogo e o relatório têm estados independentes.

**Prova:** `roster.tsx:46–54,86–95,173–183` filtra setor/texto e pagina 20; não há limpar conjunto nem seleção persistente entre páginas. `employees.tsx:514–560` tem outra busca. `publication.tsx:59–63` envia ID/revisão/modo, sem filtros da grade. O TXT tem seleção própria por filial e referências. **Funcionalidade futura ausente**, com **risco de interpretação do alcance da exportação**; os filtros atuais não estão “quebrados” por isso.

**Ajuste:** na tarefa seguinte, filtros combinados de filial/colaborador/setor/turno/matrícula, limpar filtros, contagem contextual e explicação do alcance. Antes de implementar recorte exportado, deixar explícito quando o arquivo contém o planejamento completo. Reutilizar Field/controles atuais.

**Aceite/dependência:** UI; contrato/backend se houver filtro no documento/consulta. Distinguir encontrados, selecionados e exportáveis; decidir seleção visível versus todas as páginas e comunicar a regra. Trocar filial remove seleções inválidas sem incluir filial fora do escopo. Não declarar isso já entregue.

### F10 — P2 — Catálogo administrativo fica escondido dentro da exportação TXT

**Pessoa/cenário:** administrador quer cadastrar definição para depois atribuir, mas encontra “Turnos específicos” em configurações e “Cadastrar turnos necessários” somente após manifesto TXT com omissões.

**Prova:** `escalas-workspace.tsx:285–294`; `configuration.tsx:244–262`; `shift-catalog/turno-export.tsx:174–181`. **Fragmentação comprovada**; é genérico o termo “turnos necessários” sem dizer no botão o alcance global.

**Ajuste:** próxima integração deve dar entrada administrativa de catálogo ligada à atribuição/conferência/exportação, sem duplicar cadastro nem converter a escolha operacional em criação. Enquanto isso, nomear explicitamente cadastro no catálogo da empresa e manter a confirmação existente.

**Aceite/dependência:** UI + contrato/backend catálogo. Administrador entende se altera a definição local do planejamento ou cadastro global; operador só escolhe existente. Custo moderado de organização e integração, sem dependência nova.

### F11 — P2 — Mesma aplicação tem dois nomes; “recalcular” pode parecer uma atualização automática

**Pessoa/cenário:** candidata tem “Aplicar proposta à grade”, mas ao lado do arquivo há “Usar proposta na grade”. Vários pontos sugerem gerar nova proposta e sugerir distribuição.

**Prova:** `results.tsx:229`, `publication.tsx:89,100`, `escalas-workspace.tsx:223,278`. **Inconsistência de linguagem comprovada**. A existência de ações em mais de uma área não é defeito por si só: podem evitar deslocamento desnecessário.

**Ajuste:** padronizar aplicar e manter ações contextuais de geração com ajuda de consequência. Diferenciar editar dia, ajustar referência no rascunho, aplicar candidata, salvar revisão e publicar. Não acrescentar confirmação a toda ação.

**Aceite/dependência:** UI, custo baixo. Mesma ação e estado geram mesmo texto; nenhuma mensagem afirma que gerar aplica, salvar aprova ou publicar envia folha. Fluxo cabe nas três tarefas do DESIGN.

### F12 — P2 — Robustez assíncrona desigual entre arquivos, relatório e TXT

**Pessoa/cenário:** revisão muda, acesso expira ou seleção administrativa é atualizada enquanto uma consulta/exportação TXT está em trânsito.

**Prova:** Publication compara revisão/identidade depois do blob em `publication.tsx:73–79`; OperationalReports usa AbortController/identidade em `operational-reports.tsx:18–21,40–60`; busca de ShiftSwap aborta e confere identidade em 28–55. Já `shift-catalog/turno-export.tsx:75–87,93–108,138–153` não possui token/abort vinculado ao contexto; efeito de groups limpa estado em 47–58, mas resposta antiga ainda pode chamar setLoaded/setManifest/setFiles. Há chave de revisão em 68–70 e controles ocupados: **isso reduz o risco** e não comprova download incorreto em navegação normal.

**Ajuste:** na integração, alinhar invalidação por contexto e descarte de respostas tardias; erro de 409 deve permitir conferir revisão sem instruir recarga cega quando existe rascunho. Preservar contagem de registros/omissões e confirmação de exportação incompleta.

**Aceite/dependência:** UI + runtime/backend. Atrasar respostas e mudar contexto, revogar acesso, expirar sessão ou desmontar componente: nenhum link antigo reaparece e nenhuma confirmação é reaproveitada. Não confundir URL criada com download efetivamente concluído. Trata-se de **risco sem reprodução**, não defeito de dados demonstrado.

### F13 — P2 — Erro do horário não aponta o campo/período que exige correção

**Pessoa/cenário:** administrador cria três períodos; fim vem antes do início ou há sobreposição. Recebe um alerta geral e precisa procurar qual linha errou.

**Prova:** `configuration.tsx:112–128,168–205` valida nome, períodos e ordem, mas mantém uma única string de erro, sem aria-invalid/aria-describedby por início/fim. `controls.tsx:18–25` associa label, mas ajuda não tem ID associado. A ajuda de virada de dia existe em 144–146: 25:00 significa dia seguinte. **Limitação de orientação comprovada**, não ausência de validação.

**Ajuste:** identificar número do período e campo inválido na mensagem; associar erro/ajuda ao controle e focar o primeiro erro após envio. Manter HH:MM estendido, separação de trabalho/intervalo/pausa remunerada e limites existentes, sem normalizar ou inventar horários.

**Aceite/dependência:** UI e, para erros remotos, contrato de campos. Nome vazio, horário incompleto, sobreposição, virada de dia e pausa têm motivo e localização claros; leitor de tela recebe ajuda/erro sem depender da cor. Não aceitar formatos que o produto não suporta.

### F14 — P2 — Legibilidade, foco e toque possuem base, mas faltam verificações reais

**Pessoa/cenário:** filial usa teclado ou celular, nomes longos, zoom 200% e a grade mensal com cabeçalhos fixos.

**Prova:** CSS usa tokens e foco explícito, navegação empilhada em tela estreita, alvo comum de 44px e alternativa de movimento reduzido: `escalas.module.css:34–39,50–64,68–83,149–160`. Há tabela de horários com largura mínima 38rem e wrapper horizontal em `roster.tsx:163`; isso **não prova overflow global**. Summary de fatos tem mínimo 2rem em CSS:199 e precisa avaliação contextual, sem alegar automaticamente violação WCAG.

**Ajuste:** smoke focado em renderização/teclado/leitor de tela, com foco não encoberto pelo contexto sticky e pelas células fixas; corrigir só problemas observados. Medir contraste nos temas efetivos, sem substituir paleta preventivamente.

**Aceite/dependência:** runtime/browser, não backend. Telas estreitas e 200% mantêm controles e rótulos; apenas a tabela rola internamente; ações têm nome acessível, foco visível e recuperável; estados não dependem só da cor. **Lacuna de verificação**, não defeito visual comprovado.

## O que já está melhor e deve ser preservado

- Três tarefas nomeadas com conteúdo de Escalas, contexto de filial/período/revisão e estado salvo: `escalas-workspace.tsx:39–47,198–207`. O conjunto não é uma interface genérica de landing page. “Conferências e configurações” e cadastro global aninhado ainda diluem tarefas específicas, como descrito em F10.
- 4h30 está descrito como equilíbrio dos dois períodos, mantendo duração diária/intervalo: `hours-proposal.tsx:22–23`. Não é teto diário de 4h30.
- Pausa curta diz **acima de 4h e até 6h**, somente simulação; calcula afetados com >240 e <=360 e mantém avisos: `labor-policy-fields.tsx:20–32`. Exatamente 4h não entra na dispensa; acima de 6h não é autorizado por ela. Sem aconselhamento legal adicional.
- Controle 8h/9h fica na configuração administrativa no workspace; não escolhe setor automaticamente e informa simulação: `escalas-workspace.tsx:228–233`, `mixed-42-option.tsx:26–34`. Requisito humano preservado: **administrador configura e permite; filial usa somente a configuração autorizada**.
- Referências sem grade possuem texto próprio e não devem criar presença: `hours-reference-preview.tsx:9–19`, `publication.tsx:92`. `presentation.ts:33–43,55–74` diferencia OFF, ausência, horário desconhecido e turno planejado; não trata isso como ponto real.
- Alteração diária tem prévia, limites e undo condicionado à identidade do conteúdo; save incerto e conflito têm recuperação. Essas proteções têm testes de modelo relevantes, em vez de apenas testes que espelham rótulos.
- Arquivos básicos são concedidos independentemente, publicação é separada, e gerente recebe acesso contextual. Manter esses limites durante a integração dos contratos novos.

## Leitura dos testes: o que é evidência e o que falta

Todos os caminhos abaixo são relativos a `web/src/components/escalas/`. São testes existentes, examinados em fonte; nenhum resultado de aprovação foi produzido nesta auditoria.

| Ref. | Arquivos/pontos | O que realmente exercitam | O que não provam |
| --- | --- | --- | --- |
| T01 | `access-context.test.tsx:33–86` | Função de visibilidade sem contexto/filial duplicada, render estático de boundary, arquivos e editor por perfil. | Login por nome, envio de formulário, autorização de API, navegação às áreas visitadas, revogação e persistência real. |
| T02 | `plan-selector.test.tsx:14–98` | Funções puras para período/filial/duplicados e labels/opções HTML. | Troca por clique com candidata/dirty, resposta HTTP e limites novos de autorização. |
| T03 | `draft-persistence.test.ts:10–71`, `draft-recovery.test.ts:11–27` | Fila com transportes simulados, deduplicação, edição concorrente, confirmação perdida, conflito, resposta antiga, storage ausente/expirado. | Banco, rota nova e navegador real; a expressão “real save” do nome de um teste não muda o fato de send/load serem mocks. |
| T04 | `guided-workspace.test.tsx:36–78` | Render inicial, três tarefas e controles do contexto administrativo com hook mockado. | Criação ou cálculo reais, percursos operacionais que dependem de contrato aprovado. |
| T05 | `editing-model.test.ts:46–125`, `recovery-navigation.test.ts:12–73` | Transformações de assignments, bloqueios, ausências, impacto, undo e navegação sobre destinos DOM simulados. | Execução completa de formulário, visualização/foco em browser e troca de referência via catálogo/API. |
| T06 | `mass-generation.test.ts:21–101`, `generation-operation.test.ts:8–66` | Ordem e revisões com post simulado, falhas/late response/cancelamento confirmado. | Solver real, qualidade do resultado em dados de filial, concessões/revogação reais. |
| T07 | `generation-mode-option.test.tsx:25–78`, `hours-only-ui.test.tsx:23–92`, `workspace-modes-composition.test.tsx:13–48` | Markup de modos, funções de mudança e preservação do input, restrições de referência sem calendário. | Interação montada e autorização das alterações do operador pelo novo contrato. |
| T08 | `workspace-view.test.tsx:62–112,144–174,306–355,396–419` | Render de arquivos/grade/cadastro, estado stale, candidata inválida e cancelamento; callbacks não rodam no render. | Fetch/download real, conteúdo PDF/XLSX, envio/save/apply real ou acessibilidade dinâmica. |
| T09 | `publication-review.test.ts:10–19` | Conferência apenas para conteúdo/ID/revisão limpos e atuais. | Publicação no backend nem política de acesso da rota. |
| T10 | `continuous-work-option.test.tsx:7–39`, `mixed-42-option.test.tsx:19–73`, `hours-proposal.test.tsx:23–129`, `ui-simplification.test.tsx` | Estados e textos críticos, algumas transformações reais de proposta e preservação de bloqueios; parte é render estático. | Permissão administrativa ativa, browser, validade jurídica ou Solver completo. |

Não foram localizados imports de ShiftSwap, TurnoExport ou OperationalReports nos testes adjacentes examinados. Não se extrapola isso para E2E, testes de biblioteca ou testes de outras frentes fora do recorte.

O documento de reconciliação registra execução anterior de verificações e uma limitação Windows do solver-client. É evidência histórica daquela etapa, não resultado fresco desta auditoria nem motivo para repetir suítes globais. O relatório novo do chat02 e contrato do chat01 ainda exigem integração própria; seus resultados não foram incorporados por suposição.

## Sequência recomendada para a próxima integração

1. Consumir o contrato backend liberado e fechar F01–F03/F07: entrada, criação com aprovação e cadastro por modelo. Não ativar o percurso operacional apenas porque o contexto visual existe.
2. Corrigir F04 e F05 com testes de navegação/handlers: perfil deve continuar correto dentro dos descendentes; candidata pendente exige escolha explícita ao trocar.
3. Acrescentar F06/F08 e harmonizar F11/F13 usando controles e mensagens atuais. Preservar as decisões administrativas e recuperação; erros reais não somem por simplificação.
4. Executar a tarefa posterior de catálogo/filtros F09/F10 com regra explícita de seleção e exportação. Não inventar que um filtro visual já muda o arquivo.
5. Integrar relatório final e fortalecer F12. Testar arquivo correto, revisão alterada, seleção entre páginas/filiais, erro/omissões e resposta atrasada.
6. Fazer smoke de F14 com dados sintéticos autorizados no ambiente existente, sem iniciar novo banco. Verificar teclado, foco, leitura, zoom, tela estreita e retorno dos downloads; polimento visual somente depois dos fluxos corretos.

As recomendações são pequenas dentro do sistema atual, exceto integrações já exigidas por contrato. Não há necessidade de nova biblioteca, framework de permissão, reformulação estética ou entrevista do usuário para essas decisões. A regra de manter/limpar seleção entre páginas deve ser fixada pela frente de integração e refletida nos testes; não depende de pergunta humana para registrar o problema.

## Estabilidade, limites e recursos

Foi capturado inventário inicial SHA-256 de 98 arquivos permitidos: componentes/testes/CSS e documentos/bibliotecas explicitamente liberados. A comparação final dos 98 arquivos não encontrou alterações; HEAD permaneceu `8651e77b108cd3026d50707dea60c03963c9faaf`. Os hashes abaixo fixam o recorte que sustenta as linhas citadas. Arquivos de concorrentes e segredos ficaram fora das leituras e de qualquer escrita.

Esta entrega não muda produto, políticas, schema, testes, trackers ou documentos anteriores. Não houve temporário descartável nem processo próprio; não há pasta própria a concluir ou serviço a encerrar. Recursos da fatia liberáveis com a entrega; a integração UI precisa de despacho separado.

## Inventário SHA-256 das evidências

Códigos/testes/CSS nesta tabela têm prefixo `web/src/components/escalas/`, salvo caminhos completos de repositório indicados. Cada evidência de arquivo/linha acima deve ser lida com este hash, pois HEAD sozinho não identifica as mudanças locais.

| Arquivo | SHA-256 |
| --- | --- |
| `AGENTS.md` | `b479c1c2f4f2fcfc3a7452ded8d3312165a6f69493bd1f7c42860cef4ea3791c` |
| `PRODUCT.md` | `27bca4ea7013a099bddaa815c7681944e8cd67f263326dd42e1d45b3733e8d3b` |
| `docs/escalas-language-audit.md` | `7877c64cce8078a253e0a5efb7efed37d05e3e364fc0290c582bbea6181b99c4` |
| `docs/escalas-base-reconciliation.md` | `f18fb2809cc985d0f73724f907825e853283ede36735a6c9dc8a3e0fc2ef9b36` |
| `access-context.test.tsx` | `3f76e339b3eeb6032abdb4281f204e33f1ed123c753249eb7a59e9ca4283846b` |
| `access-context.tsx` | `79b8ab93f899faaa777d7dac50057dd883e2eed0bf29d79c14f0b13960744724` |
| `configuration.tsx` | `02700f1ebe4edcb5aa02b76c9aff0d87dbbc323d5a64c8462f44bcb5a20f71a7` |
| `continuous-work-option.test.tsx` | `d1b735d21eded65fe1a8c6db6fadac487adc325df6fcb9eced0187745a5b41ed` |
| `controls.tsx` | `691ab83aafb700a07d007530ffd6989572aff94e233fffde00430afd6e5682e3` |
| `draft-persistence.test.ts` | `0aadc6e628abd8dd40f19db3bac5f2307b8759a573a2e162473e8a9e68d35048` |
| `draft-persistence.ts` | `488220112b631a36e38161db48ef06e11da2ae0d6acab3de6c3bd53585dfd6c3` |
| `draft-recovery.test.ts` | `371cbd70102ab95897fc35883927e31d5068c966d86c8381f6f8dfb8cd93caba` |
| `editing-model.test.ts` | `59578456d04de288d308355860a05117a07ec405e58d82ca3a3fe87aa5384aea` |
| `employees.tsx` | `4a1111258e88ccda5c6e5882d5857a31a21b5312350fd938c9ce81dad7da8722` |
| `escalas-workspace.tsx` | `5e8172e891f752ebdc1500bd2cf66989f631c36293dc95de0d6a54138ff5ee68` |
| `escalas.module.css` | `78e68bfd2f36f17142357cef14cc24ed0cb501fe14c14061540336290b3554b4` |
| `generation-mode-option.test.tsx` | `d11b9a8125401c9f7345f65bfd8b05b011698917936892104828711804a012d2` |
| `generation-operation.test.ts` | `0545400b9feb23d7d3e262119e1c7d155f2e9e0599a659b48b00a5a8b364cb2f` |
| `guided-workspace.test.tsx` | `fa29bac52def02f1f239d2d4ed4a51a06815c89d2a3f61524cd7a9dc7ab31994` |
| `hours-only-ui.test.tsx` | `854ba8ce094e0ecae941e0649f81b20b94fc34606292ac41fb80fdd8fb8fa70d` |
| `hours-proposal.test.tsx` | `a697a9d59aca8203a28ea2c2974c5fabed55db5833769aa23b707f39a6a9e206` |
| `hours-proposal.tsx` | `df4a0040df2ededf55ead9d509380c8c14309ab4c809c438ba4a23178f9b685c` |
| `hours-reference-preview.tsx` | `2adaf5d3a53d8a1ab7e9f4797d5ac66ecc9f99121a6d71664c6b4e8d3ac7336d` |
| `labor-policy-fields.tsx` | `641886d3ce2a3e9265cb2a84a112c88ca6e12d11f61afb70271346367c968468` |
| `mass-generation.test.ts` | `67171e44416668a9ac861b99eb0597dcf157d33140c3ab00f607a3212cef1e3e` |
| `mixed-42-option.test.tsx` | `54b823f8df954909102d9ad2539442f948dd87cfd328a5e4446352341b9e614c` |
| `mixed-42-option.tsx` | `f45e84a667c750de15338c943d8fa3d6924adde740d49d15cabe403b065361a9` |
| `operational-access.tsx` | `01ee320001687ecd54155f444016a5649c54c107a01b811233f96a2b7aa0ceff` |
| `operational-reports.tsx` | `3686079c7bbcf79a5e6cebc059ac59ee11e4cadf920cbb76ecfbf38f7450934d` |
| `plan-selector.test.tsx` | `b625d59ac218cb67c9dac65a070a7a923569a5e281e1b20351999fc22f4d9a2c` |
| `plan-selector.tsx` | `6137bb84ec6fe45023936fc429cfc6acb9c29e981d85c56e1b463ffff5485eb6` |
| `publication-review.test.ts` | `b891008f7d764c8766e10e2f9cfe619b69e43f419ebf006a112469de01e0a182` |
| `publication.tsx` | `f72cb9248191d00d53ac804d598b672f7b790da0c2c600477b4d6766ee1deb67` |
| `recovery-navigation.test.ts` | `68adfbd982ecf6f8a7033de2c457bf077b7a8b3528c9b25cb5ede609c67f39c6` |
| `results.tsx` | `6bc72047747154fe4b356a852961ea1814ab8a8f2cce94e97b0dd4217d444a8c` |
| `roster-editor.tsx` | `b2bed5a6d031912cb180a3caf15a44396f3714359452b0437ec235c2470ff520` |
| `roster.tsx` | `e9894e5b9f31e5ebcc89812e1304a7172785dd44640149d6dce7fc21f7019c0e` |
| `shift-catalog/shift-swap.tsx` | `658fde743d2048c72906ac1163c787d58b66d571d5d898d4f7de2dcbf2b66791` |
| `shift-catalog/turno-export.tsx` | `7a8ee2d5901da679b3d6c890c323d32d149d98cc9d126f04c0405763c9ecbbdf` |
| `ui-simplification.test.tsx` | `2bdcebe45d58cffb6abfc54d18367d888554f246644fa319660b02ae9c68ac6a` |
| `use-escalas-workspace.ts` | `9461191638c5af1a8483a925704e5c6ce94ea693cdcd5ae59904a8876a04118b` |
| `workspace-feedback-model.ts` | `953de79767c3c13d73db5b96eb433980654ef59fa09fc320dadbe0b414a2c6ae` |
| `workspace-modes-composition.test.tsx` | `f48010f6a39edb60305d63de2e9ef3e941e1b242d36094332449cbfff6fdcf11` |
| `workspace-view.test.tsx` | `239464449920a6bdc8c568664307ed3959c2ccd655ed4a8f33152108036d4c66` |
| `DESIGN.md` | `74b0c5bf60b0508d0117309463f212fa1bda32bad25130e98e22632c45e40fe3` |
| `web/src/lib/escalas/permissions.ts` | `2a3890ef413bd3904396e860212c8ee240561238d49da77b7c2ef8f1fa828729` |
| `web/src/lib/escalas/presentation.ts` | `3bf1312d5f2c03c1e19d70de0d965052408b5182dee81d5296877b1fb2c42cee` |
