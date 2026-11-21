# Revisão independente dos reparos AUIR01 e AUIR02

Tarefa `AUX-ADMIN-IMPORT-UI-FIX-REVIEW r1`; despacho `AUX-ADMIN-IMPORT-UI-FIX-REVIEW:r1:batch278`; gate278/reserva279. Data: 14/11/2026. Checkout exclusivo: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

**Resultado: APPROVED para o candidato delimitado de reparo AUIR01 P1 e AUIR02 P2.** Não foi identificado novo achado bloqueante no recorte. A aprovação não abrange PostgreSQL, autenticação/E2E reais, integração global ou produção. Não houve alteração de produto por esta revisão.

## Integridade e método

As quatro entradas conferem com os SHA-256 informados:

| Entrada | SHA-256 |
|---|---|
| docs/escalas-admin-import-ui-review.md | 2c299197136c7eca63f56fe80d6db5128ac0ae777ac570faf06cb85cdba61615 |
| docs/escalas-admin-import-boundary.md | 9487a0849daad9b23f2a5a0d0740851e96c448de732995008e602057e930569a |
| docs/escalas-admin-import-ui-fixes.md | 1b50fa8ac278c7f08a92e79264fc5615c15a627e1451519e5fb85cd4a268debe |
| outputs/escalas-admin-import-ui-fixes/manifest.json | 869a85d5bb069ac984c71b7e132fec6c4e452b5f1f16e43924897d14ad2a609f |

Foram verificadas as 52 entradas do manifesto: cinco fontes do candidato, dez referências somente leitura e 37 artefatos. Nenhuma divergência. A revisão leu código, testes, adaptadores e logs existentes, além de reabrir oito capturas finais. Não surgiu hipótese nova concreta que justificasse executar novamente suites aprovadas. Os resultados de testes e navegador abaixo são evidências existentes conferidas, não novas execuções desta revisão.

## AUIR01 P1 — corrigido no candidato

**Falha comprovada anteriormente:** a prévia e o resumo de APPLY válidos incluíam ABSENCE mantido nas bordas do workspace, fora do intervalo substitutivo. O cliente tratava esses dias como delta alterado e recusava a resposta. A prova anterior registrou falhas tanto antes da confirmação como na aceitação pós-gravação simulada. Não se trata de um segundo achado distinto do diagnóstico de fronteira.

**Correção na origem da rejeição:** `web/src/components/escalas/import-replacement-client.ts:40-51` constrói os conjuntos da base canônica e separa os critérios:

- Adicionados, removidos e atribuições alteradas continuam dentro do intervalo confirmado, em `49`.
- Mantidos precisam estar dentro do horizonte do workspace, ter pessoa/matrícula exatamente correspondentes à base e já existir como ABSENCE naquela pessoa/data, em `50-51`.
- Não basta a resposta declarar que o registro é mantido; não é aceita pessoa desconhecida, matrícula sem os zeros, data fora do workspace ou dia que não era ABSENCE na base.

Os guards de schema, contexto, revisão, filial, horizonte, mês visível, status, escopo, contagens e elegibilidade continuam em `import-replacement-client.ts:11-25,35-48`. O digest de APPLY e `canApply` continuam exigidos em `52`. Os bytes do arquivo são comparados ao hash retornado nas duas ações em `65,75-81`. A adoção exige workspace correto, revisão seguinte, DRAFT e mesmo horizonte em `82-84`.

A mesma função é usada no PREVIEW e no resumo APPLY (`76` e `80`). Logo, a exceção não libera uma resposta só em uma das etapas. As negativas estão em `import-replacement-client.test.ts:26-35`: fora do workspace, pessoa desconhecida, matrícula divergente, afastamento inexistente, inclusão fora do recorte, atribuição alterada fora do recorte e remoção fora do recorte. Contexto/contagens/elegibilidade e hash permanecem cobertos em `37-57`.

**Prova integrada permanente:** `web/src/components/escalas/import-replacement-boundary.test.ts:69-76` encaminha o fetch ao POST real e devolve a mesma Response; o clone serve apenas à observação. Não reconstrói JSON para tornar a resposta compatível. Em `121-149`, PREVIEW e APPLY usam a base canônica obtida pelo serviço, preservam 30/11 e 01/01, mantêm 03/12, retiram 02/12 e incluem 04/12. As contagens são 1 inclusão, 1 retirada, 3 mantidos e 2 mudanças de atribuição. O input aceito é igual ao efetivamente salvo no adaptador.

A continuação diagnóstica de APPLY nas linhas `131-135` usa o hash da prévia original do backend mesmo se o cliente a recusar, para expor a falha pós-gravação. Ela não mascara a falha: as linhas `146-149` exigem explicitamente ausência de erro no PREVIEW, ausência de erro no APPLY e igualdade do workspace retornado com a persistência simulada. Os controles de sucesso sem bordas e fontes parciais continuam nos mesmos testes.

**Adoção:** `web/src/components/escalas/use-escalas-workspace.ts:291-315` mantém guards de acesso, contexto, pendências e cancelamento, usa a base salva após `flushDraft` e só chama `acceptWorkspace` depois da resposta validada e de nova conferência do contexto. O hook não foi alterado. O navegador com hook real registra uma única requisição APPLY, revisão 3→4 e preservação das duas bordas. Essa fixture usa inclusão em 03/12; é distinta do cenário real de fronteira que inclui 04/12, e suas métricas não foram misturadas.

Conclusão: a causa da rejeição indevida foi corrigida sem remover o limite do delta alterado nem afrouxar os guards revisados. Confiança alta para o recorte e para as fontes vinculadas aos hashes.

## AUIR02 P2 — corrigido no candidato

**Falha comprovada anteriormente:** fim vazio, fim além do horizonte e intervalo invertido marcavam/focalizavam o início válido. O `red-browser.json` registra `active` no início quando o esperado era o término, além do `aria-invalid` aplicado ao campo errado.

`web/src/components/escalas/import-replacement.tsx:21-30` agora calcula erros independentes de início e fim. As duas datas são validadas como datas reais e dentro do horizonte. Se ambas são individualmente válidas, ordem inversa e duração acima de 42 dias pertencem ao término. Em `64`, o foco ocorre após a atualização do DOM, priorizando início quando ambos têm erro. `65-76` interrompe a ação antes do pedido. Um erro residual de contexto usa o resumo, sem atribuí-lo a uma data válida.

Os Fields recebem somente seu erro correspondente em `105-106`. O componente existente `web/src/components/escalas/controls.tsx:20-34` associa `aria-describedby`, `aria-invalid` e mensagem com `role=alert` ao controle correto. O erro explícito de consulta continua em resumo focalizável (`import-replacement.tsx:63,112`). A troca dos campos continua invalidando prévia, aceite e declaração; não foi removido o tratamento de resultado incerto após APPLY.

`import-replacement.test.tsx:12-27` cobre fim vazio/fora, início fora, ordem invertida, ambos vazios, limites exatos e duração excessiva. As provas de navegador conferem `document.activeElement`, `aria-invalid`, a mensagem associada e ausência de pedidos para datas inválidas. O caso de erro de consulta focaliza o resumo e mantém a revisão 3.

Conclusão: o erro pertence ao campo inválido e o foco segue o primeiro inválido nos cenários examinados. Confiança alta para o recorte, sem alegação de auditoria completa de acessibilidade.

## Inspeção visual e orientações aplicadas

Foram reabertas, por leitura de imagem local, as capturas finais em `outputs/escalas-admin-import-ui-fixes/`:

- `green-end-empty.png`, `green-end-outside.png` e `green-inverted.png`: término destacado/focalizado, início sem erro e mensagem específica abaixo do término.
- `green-start-outside.png` e `green-both-empty.png`: início focalizado; no segundo caso ambos recebem suas mensagens.
- `green-borders-preview.png`: dias mantidos nas bordas aparecem separados de inclusões/retiradas; confirmação nomeia filial e intervalo e não promete publicação.
- `green-borders-saved.png`: revisão 4 adotada e mensagem de importação confirmada, sem publicação.
- `green-action-error.png`: resumo visível/focalizado e nenhuma alegação de substituição solicitada.

As imagens correspondem à fixture em 390×900, tema claro. Textos e controles do recorte permanecem legíveis, as mensagens ficam junto ao campo correto e não há corte horizontal observado. O script `browser.cjs:25-35` também confere foco, mensagens, zero pedidos inválidos, ausência de erros de página e largura de documento ≤390. Não foram inferidos zoom real, leitor de tela ou interação física de toque a partir das imagens.

UI/UX Pro Max foi aplicado com consulta local `error summary validation focus --domain ux`: retornou orientação pertinente sobre resumo focalizável, anúncio de erros e mensagem inline ligada ao campo. Foi usado o Python absoluto resolvido por `load_workspace_dependencies`, sem instalar dependências ou gerar arquivos. Impeccable foi aplicado pelo SKILL.md e referência de audit, com foco no modo Operate, preservação do sistema existente e evidência renderizada. O carregador automático/contexto e o detector não foram executados para preservar o escopo estrito de leitura e evitar descoberta/instalação fora da tarefa. frontend-design foi aplicado somente à semântica, consistência e acessibilidade; nenhuma diretriz decorativa foi usada para ampliar o reparo.

## Provas, preservação e limites

Logs conferidos: vermelho com 3 falhas e 14 sucessos; verde com 28 testes em quatro arquivos; lint dos cinco arquivos e tipos com saída zero; sete cenários finais de navegador aprovados. Os testes permanentes incluem cliente→rota/serviço e isolamento. O navegador usa componentes, hook e CSS reais com respostas sintéticas; não chama o backend real. São evidências complementares, não E2E autenticado completo.

Contrato r2, reconciliação, FPRE136, rota, hook, montagem e CSS coincidem com `readonlyExpected`. O serviço SAVE permanece `a925120442aea5fecccef827802f592b3eb6ebeae7cca0d17d1cfc5f027c4ac1`, igual ao registrado na revisão anterior. A correção AIBR01 não foi reaberta ou substituída por esta revisão. As fontes de catálogo também conferem com o manifesto da correção, sem edição desta tarefa.

Persistência e sessão dos testes são simuladas; não há prova de locks, rollback, concorrência ou PostgreSQL real. Next shell/fontes, zoom 200%, leitor de tela e demais larguras/temas não foram revalidados. Não houve leitura ou compilação de Prisma, migrações ou E2E, execução de runner global, Solver, serviço de fundo, dependências, produção, commit, push ou deploy.

Context Mode efetivo: `ctx_execute` para análise/hashes, `ctx_batch_execute` para coleta/indexação. Capturas abertas por `view_image`. Nenhuma escrita por Context Mode; somente `apply_patch` no relatório e manifesto próprios. Não foram criados descartáveis ou processos de fundo; não há pasta temporária a concluir nem recurso próprio pendente. Recursos da reserva279 liberados ao entregar.
