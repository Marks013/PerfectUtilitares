# Revisão independente da interface de Escalas

## Identidade, método e conclusão

Tarefa `AUX-UI-INDEPENDENT-REVIEW r1`, despacho `AUX-UI-INDEPENDENT-REVIEW:r1:batch122`, gate 122 (`c42dcaea81ea69f222bfa3bf07b247a0be784c7115bd9314dbed94abff3c8179`), reserva 123.

Raiz revisada: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`. Revisão estática independente da implementação entregue pelo chat 05, para uso por equipes de filial sem experiência técnica. Código, testes e contrato HTTP r3 foram confrontados. Não foram executados testes, navegador, servidor, banco, Solver, build, quality ou typecheck. Nenhuma fonte de produto foi editada. A única escrita desta tarefa é este documento.

O hash de `escalas-ui-integration.md` coincide com o fornecido no despacho. As 29 entradas de fontes/contrato com SHA-256 encontradas na tabela da entrega coincidem com os arquivos atuais. Isso estabelece a revisão examinada; não significa execução independente dos testes relatados pela entrega.

**Conclusão:** a implementação resolve parte substancial dos achados anteriores, mas ainda não está pronta para aceite funcional completo. Há um achado P1 e três P2 demonstráveis pelo fluxo do código, descritos abaixo. Eles não são alegações de exploração do backend ou de falha reproduzida no ambiente real. A integração de catálogo/filtros F09/F10 continua expressamente pendente e não foi tratada como regressão surpresa.

## Achados comprovados na fonte

### IR01 — P1 — Reentrada com outro operador conserva estado e conflito do acesso anterior

**Evidência:** `operational-access.tsx:52–56,85`; `use-escalas-workspace.ts:119–143,237–245,506–517`; `escalas-workspace.tsx:111,198–203`.

O boundary mantém os filhos montados ao bloquear; ao entrar novamente, apenas substitui o contexto e emite `escalas:unlocked`. A lista de planejamentos é buscada no efeito de montagem, com dependências vazias. Na reentrada, o hook retoma o salvamento anterior quando há edição, ou abre o workspace anterior; não distingue o operador anterior do novo e não recarrega a lista autorizada. O evento de bloqueio também não invalida os pedidos em andamento.

Há um efeito visual específico além da lista desatualizada: a seção de conflito de revisão (`escalas-workspace.tsx:198`) lista nomes, matrículas, setores, horários e ausências **antes** da guarda `can("workspace.read")`, que só começa na linha 203. O conflito anterior não é limpo ao bloquear ou trocar o contexto. Assim, se A deixou um conflito aberto e B entra com outra filial, o painel antigo continua elegível para renderização, mesmo que a grade principal seja corretamente ocultada.

**Caminho proposto para reprodução, não executado nesta revisão:**

1. Operador A abre um planejamento da filial A e usa a comparação de revisão até aparecer o painel de conflito.
2. Bloqueia Escalas e entra como operador B, autorizado somente à filial B.
3. A lista continua derivada da consulta de A; o hook tenta reabrir o planejamento de A. O conflito anterior permanece no estado e seu painel está fora da guarda da filial.
4. Na variante com rascunho sujo, a reentrada inicia uma tentativa de salvar o rascunho anterior sob a nova sessão, sem B escolher assumir essa edição.

**Impacto:** contexto visual de outro acesso, possível exibição indevida no painel de conflito, lista incompleta para B e tentativa automática de salvar trabalho de A. O servidor ainda pode e deve negar recursos/comandos sem permissão; não foi examinado nem se afirma contorno dessas guardas. A aceitação da entrada por nome como navegação, sem identidade forte, não torna correto reutilizar o estado de outro acesso.

**Direção de correção para despacho próprio:** separar retomada do mesmo acesso de troca de acesso; invalidar respostas antigas, atualizar a lista e retirar todo conteúdo fora do escopo corrente, inclusive conflito/recuperação. Preservar o rascunho anterior de forma isolada, sem enviá-lo automaticamente como trabalho de outro operador.

**Teste delimitado recomendado ao Maestro:** montar o boundary/hook com A, produzir conflito e edição pendente, bloquear e responder à reentrada com contexto B. Conferir que não há nomes de A, nova consulta da lista de B e nenhum SAVE automático de A. Justificativa: os testes adjacentes de papéis verificam markup/contexto e comandos isolados, não essa sequência entre acessos.

### IR02 — P2 — Salvamento automático pode apagar o formulário de novo colaborador em preenchimento

**Evidência:** `escalas-workspace.tsx:108,264`; `approved-forms.tsx:56–74`; `use-escalas-workspace.ts:70–85,92–101,568`.

`ApprovedEmployeeForm` recebe a chave `workspace.id + ":" + workspace.revision`. Nome, matrícula e modelo ficam em `useState` dentro do formulário. Qualquer revisão salva faz React desmontá-lo e criar outro com os campos vazios. O formulário não é bloqueado por `dirty` ou por `saveState === "saving"`: `editTeam` usa `model.canEdit`, que não inclui esse estado de salvamento.

**Caminho proposto:** editar um colaborador existente ou um dia da grade; enquanto o salvamento automático aguarda resposta, começar a cadastrar outra pessoa por modelo. Quando chega a nova revisão, a chave muda e o preenchimento desse cadastro desaparece. Isso não exige falha do servidor, apenas uma resposta de salvamento posterior ao início do preenchimento.

**Impacto:** perda silenciosa de dados digitados, particularmente difícil de entender para a filial. O cadastro ainda não foi submetido, portanto a recuperação do rascunho da escala não o contém.

**Direção de correção:** manter a identidade do formulário ao salvar edições não relacionadas; limpar seu conteúdo somente após sucesso do próprio cadastro ou descarte explícito. A aprovação vigente pode ser revalidada sem apagar automaticamente nome e matrícula.

**Teste delimitado recomendado:** começar o formulário, devolver um SAVE pendente com revisão incrementada para o mesmo workspace e conferir que nome/matrícula continuam. O teste deve distinguir esse caso do sucesso de ADD_EMPLOYEE, que pode encerrar o cadastro. Não requer banco nem nova execução de suíte ampla.

### IR03 — P2 — Falha na consulta de modelos também é apresentada como falta de vinculação aprovada

**Evidência:** `approved-forms.tsx:21–26,57–60,76–80`.

Quando a consulta falha, o hook registra `error`, termina `loading` e mantém `policies: []`. O formulário renderiza o erro, mas também renderiza a orientação de que o planejamento precisa de aprovação porque a condição da linha 78 é apenas `!policies.loading && !approval`; ela não exclui a falha de consulta. O planejamento pode ter `approvedPolicyVersionId` válido e vigente, sem que o cliente tenha conseguido consultá-lo.

**Caminho proposto:** abrir um workspace vinculado e fazer a consulta de modelos retornar 503 ou falhar na conexão. A tela mostra simultaneamente a falha de comunicação e uma orientação para o administrador conferir a liberação.

**Impacto:** indisponibilidade é confundida com ausência de aprovação, reabrindo parte de F08. O usuário pode pedir uma alteração administrativa desnecessária em vez de repetir a consulta.

**Direção de correção:** distinguir consulta pendente, consulta malsucedida e consulta bem-sucedida sem a aprovação vinculada. Só afirmar ausência/revogação após uma resposta válida que a demonstre.

**Teste recomendado:** consulta 503 para workspace com aprovação vinculada; deve aparecer erro recuperável e nova tentativa, sem a mensagem de falta de vinculação. O formulário de criação já distingue melhor esses estados na linha 50, com `!policies.error`; esse padrão pode ser reutilizado.

### IR04 — P2 — Entrada por nome e consulta de aprovação não têm prazo de espera recuperável

**Evidência:** `operational-client.ts:16–19,28–30`; `operational-access.tsx:47–58,75–80`; `approved-forms.tsx:17–26,48–51`.

O pedido de entrada usa fetch sem sinal de cancelamento ou prazo. Enquanto permanece pendente, todos os controles de entrada ficam desabilitados, sem cancelar ou tentar novamente. A consulta de aprovação tem AbortController para troca de contexto/desmontagem, mas não prazo; o botão de consultar novamente fica desabilitado durante `loading`.

**Caminho proposto:** manter a requisição pendente, sem sucesso nem erro. A interface continua em “Verificando acesso” ou “Consultando configurações aprovadas”, sem uma recuperação direta no próprio fluxo. Não se afirma que toda rede ficará indefinidamente nesse estado; a ausência de um limite/ação da aplicação é o fato verificado.

**Impacto:** perda do percurso operacional em conexão lenta ou requisição suspensa. A equipe leiga precisa adivinhar que deve recarregar ou alterar contexto. É uma lacuna remanescente de F08/F12, mesmo com os erros HTTP e os downloads já tratados.

**Direção de correção:** prazo coerente com a operação, encerramento do estado ocupado e mensagem com nova tentativa; respostas antigas não devem desbloquear uma sessão mais nova.

**Teste recomendado:** fetch pendente que respeita abort, relógio controlado e retorno tardio. Conferir saída do estado ocupado e rejeição da resposta antiga. Proposta ao Maestro, não executada nesta fatia.

## O que foi resolvido, parcialmente resolvido ou depende do ambiente

| Critério | Evidência atual | Conclusão independente |
| --- | --- | --- |
| F01 — nome e precedência | Boundary oferece nome cadastrado, explica o limite de identidade e mantém conta administrativa; cliente aceita contexto de conta retornado pelo servidor | Implementado na UI; IR01/IR04 pendentes. Ativação efetiva e enforcement não verificados |
| F02 — planejamento aprovado | Consulta filial/período exatos; CREATE_APPROVED envia ID da aprovação | Caminho implementado; transação real e aprovação vigente exigem integração |
| F03 — colaborador por modelo | Nome/matrícula/modelo; ADD_EMPLOYEE com revisão; sem ID, vínculo ou jornada livres enviados pelo operador | Implementado com IR02/IR03 pendentes. Duplicidade e CAS reais não são provados por mock |
| F04 — descendentes analíticos | `results.tsx:220–229,242–257` e `roster.tsx:28,47–50,104` conferem a capacidade; sem contexto não recebem autoridade | Correção de fonte consistente; não equivale a autorização do backend |
| F05 — candidata e navegação | `pendingNavigation` considera candidata mesmo sem dirty; ações explicam salvar versus descartar; `update` remove candidata após edição | Resolvido no percurso de troca interna examinado. IR01/IR02 mostram outros pontos de continuidade ainda abertos |
| F06 — configuração versus leitura | Resumo de distribuição e campos protegidos na área de geração; controles dependem de administração | Separação implementada; conferir valores reais do modelo aprovado na integração |
| F07 — definir versus atribuir | `escalaCatalogActions`, guarda em Shifts e autorização de atribuição no pai | Distinção presente. REST_ONLY não monta ShiftSwap, limitação já registrada; não é descoberta nova de F09/F10 |
| F08 — estados e recuperação | Status, conflitos, vazio, proposta inválida e recuperação explícitos | Melhorou; IR01, IR03 e IR04 impedem declarar fechamento completo |
| F11 — ações e nomes | “Aplicar proposta à grade” nos dois pontos; aplicar com prova informa revisão salva e não publica | Nomenclatura consistente. Prova real/expiração e SAVE precisam do backend integrado |
| F12 — respostas e arquivos | Versão/sinal no hook; PDF/XLSX conferem MIME, corpo e revisão/modo; fontes TXT têm controles de contexto relatados na entrega | Guardas de fonte presentes; IR01/IR04 ainda abertos. Não foram baixados/abertos arquivos reais nesta revisão |
| F13 — erro de turno | Parser específico, `aria-invalid`, associação de erro e foco no campo; helper Field conserva descrição existente | Correção de fonte consistente; sem repetir o teste aprovado. Teclado real continua integração |
| F14 — acessibilidade | Botões nativos; rótulos; foco visível; controles 2,75rem; redução de movimento; seções ocultas/inert | Base concreta, sem certificação global. Zoom, leitores de tela, contraste dos temas e foco completo não foram vistos em navegador |
| F09/F10 — catálogo/filtros | Explicitamente destinados à próxima integração no contrato r3 e no relatório da entrega | Fora do aceite desta fatia; não declarar completos |

### Limites da evidência de testes

`role-integration.test.tsx` usa `renderToStaticMarkup`; demonstra papéis/textos e composição, não efeitos de sessão, cliques, concorrência ou salvamento. `operational-client.test.ts` usa respostas de fetch substituídas; demonstra formato dos comandos e tratamento de alguns erros, não autorização real, cookie, SQL ou transação. `workspace-navigation.test.ts` exercita a decisão pura de navegação, não o ciclo inteiro do hook.

O relatório do 05 descreve uma prévia React/hook com interceptação HTTP e cenários sintéticos; essa é evidência relatada, não foi repetida aqui. O próprio relatório distingue esse cenário de aplicação completa e produção. Os quatro achados acima cobrem sequências que os testes adjacentes examinados não demonstram. Não foi afirmada inexistência de qualquer teste em outras frentes.

Ainda precisam de ambiente autorizado: entrada/reentrada e revogação reais; lista por filial após troca de acesso; aprovação real e cadastro com revisão concorrente; prova assinada, expiração e aplicação; sessão alterada durante pedidos; bytes finais de downloads; fluxo completo por teclado, zoom de 200%, leitores de tela, temas e dispositivos reais. Não há autorização de release nesta entrega.

## Aplicação das skills e ferramentas

- **UI/UX Pro Max:** instruções carregadas nesta conversa; duas consultas reais à base local: `loading timeout retry` retornou Loading Indicators; `error field focus` retornou Error Placement e Focusable Error Summary. Os critérios foram usados para IR03/IR04 e para conferir associação/foco de F13, sem impor outro visual ao projeto. A segunda consulta foi corrigida após um erro de invocação de caminho; o resultado final foi obtido com o Python do runtime existente.
- **Impeccable:** SKILL.md e referências de audit/critique lidas; o binário instalado executou `context --target .../escalas-workspace.tsx`, carregando PRODUCT.md/DESIGN.md. Aplicado o modo Operate: consequências, recuperação, carga cognitiva e estado de formulários. O usuário delimitou revisão estática sem agentes/navegador; não se declara execução integral do workflow critique, detector ou avaliação visual. Nenhum gate de skill ampliou essa autorização.
- **frontend-design:** aplicada a correção técnica, HTML semântico, acessibilidade e coesão com DESIGN.md. Não foram exigidas nova fonte, animação ou identidade estética em um sistema operacional já estabelecido. Não foi gerada interface nova nem atribuído escore visual sem renderização.
- **Context Mode:** ferramentas descobertas no inventário; `ctx_execute` validado com leitura/análise e hashes; `ctx_batch_execute` usado em coleta independente; `ctx_search`, inclusive timeline, usado para localizar contexto. A coleta PowerShell mostrou acentuação incorreta na saída; os trechos decisivos foram reconferidos como UTF-8 via Node dentro de `ctx_execute`, sem atribuir o problema ao produto. Nenhuma escrita foi feita por Context Mode.
- Escrita exclusivamente com `apply_patch`, neste relatório. Nenhum arquivo descartável próprio foi criado; portanto não há pasta temporária própria a concluir. Não há serviço ou processo em segundo plano desta tarefa. Sem subagentes, mensagens laterais, instalações ou mudanças em fontes concorrentes.

## SHA-256 das fontes e entradas examinadas

Os caminhos da primeira tabela são relativos a `web/src/components/escalas/`. Foram lidos os trechos pertinentes à revisão; o hash identifica o arquivo completo, não afirma leitura integral de cada linha nem teste executado.

| Arquivo | SHA-256 |
| --- | --- |
| operational-access.tsx | `eee75b9f22e42ccba1a1ffc765247b81a14398b809fde0a9ff59b0d60c5eeab8` |
| operational-client.ts | `58710ffa67991913294252b429f002231a5a4eeb06a00c12b136f72a21131eb7` |
| use-escalas-workspace.ts | `9674ad78fcf35afc82b903f631bdf3bd812d4c0e6f6b2006413b77c09dd9f23a` |
| escalas-workspace.tsx | `ff6a5851ea2960cfc91d4128e96d3c9c540b6607be6d93c06e015ea79775788d` |
| approved-forms.tsx | `7545daf692223a5c944dfb2f48d76e32304219d395f2c90f44e204030d751da6` |
| approval-administration.tsx | `c09fe35a1c25f20c945f0154c1446fa1a0927f27ae225a7845fe568ccf5e461b` |
| operator-administration.tsx | `63999fd85e7d7cdebb75e5f491d35ec95a4c98a8d710ea2cd3262da225e34354` |
| publication.tsx | `723a5a6d6ce17687fc1c8099c8fb51ec610dd6953e7ff23b9144c2f1efc45f57` |
| controls.tsx | `688e8e70185e235e5ddb498c58d07e02c2a75d6263611b02dc5237bbfead7330` |
| configuration.tsx | `cd690faf85472fe16f3201ecbb92d28b99b9b41bd18f5830aa0e46bfeb23005d` |
| results.tsx | `3d2bdbdb0f743d23cb604707460a52727fbe04711f79c446135082196e17cecd` |
| roster.tsx | `8bc54e4f72c0702706eabca19335d27a4a5d7756b404f0627023cb0646f45b44` |
| employees.tsx | `4a1111258e88ccda5c6e5882d5857a31a21b5312350fd938c9ce81dad7da8722` |
| access-context.tsx | `79b8ab93f899faaa777d7dac50057dd883e2eed0bf29d79c14f0b13960744724` |
| workspace-navigation.ts | `62ceec541637d825554e2dccedd38ff7cefc5a4938f810b1244134bb782a68ab` |
| role-integration.test.tsx | `fae7b3d5b4ff5dcc644668be59b0fdd0243810032a6610a7edc0c02717906c99` |
| operational-client.test.ts | `9ef76986b768dfbe17ebfcd9d45f15026e2ddc9d72f0847dd95763558c4c5855` |
| workspace-navigation.test.ts | `6befac649a6b5381ceebb727c7145833ef76e8fe449155a1ce300addd875c8ab` |
| access-context.test.tsx | `0066f000d3fd4360bbd00fe01c46783aefac65b916f2f8c1f17461472ee62d91` |
| workspace-view.test.tsx | `7870d10062545c217dbfd4fe21a8ae0c7c69f82977e2414a51bbb6594c095733` |
| escalas.module.css | `78e68bfd2f36f17142357cef14cc24ed0cb501fe14c14061540336290b3554b4` |
| shift-catalog/shift-swap.tsx | `658fde743d2048c72906ac1163c787d58b66d571d5d898d4f7de2dcbf2b66791` |

| Entrada adicional | SHA-256 |
| --- | --- |
| web/src/lib/escalas/access-contracts.ts | `c00eab12193033610979c4274e07e0f673aa42e31d38fc8b9693d92a24be02f0` |
| web/src/lib/escalas/access-view.ts | `290c6e2ab99b3773a775b214a1801f34e09e8e5c95f34fe022d62b300eff1a01` |
| web/src/lib/escalas/types.ts | `c49982f886402fc55a65592657def80866c0fe0733463e5c942116ad049e454b` |
| docs/escalas-ui-integration.md | `4ceba2cb8d125525d3719b82a7d5a313a1f32c9482d0a7f08e2598c61def8b25` |
| docs/escalas-ui-readiness-audit.md | `1117b1a71cb98ac13a40264c009600c607cc27628e577e8952550dda7948b312` |
| docs/escalas-access-api-contract.md | `ae54c287a05859ada188806d706e5deaa7311d7c08a6bb6cc0ac983ce1c4c38f` |
| PRODUCT.md | `27bca4ea7013a099bddaa815c7681944e8cd67f263326dd42e1d45b3733e8d3b` |
| DESIGN.md | `74b0c5bf60b0508d0117309463f212fa1bda32bad25130e98e22632c45e40fe3` |
| Repositório original: outputs/apoio-maestro-20261113/criterios-interface-turnos.md | `7742d9bda7807d5c292440d497e1085b8e36fdb73e04c2da1f12129b992f26e1` |

## Encerramento

Recursos de leitura e escrita deste despacho liberados após a entrega. Os quatro achados ficam propostos para correção e testes delimitados em novos despachos; esta revisão não corrigiu produto, não alterou trackers e não acompanhou continuamente os demais trabalhos.
