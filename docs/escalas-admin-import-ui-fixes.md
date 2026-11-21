# Importação administrativa — correções de fronteira e datas

`AUX-ADMIN-IMPORT-UI-FIXES r1` · despacho `AUX-ADMIN-IMPORT-UI-FIXES:r1:batch266` · gate266/reserva267 · 14/11/2026. Checkout `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

**Resultado: AUIR01 e AUIR02 corrigidos e verificados no recorte autorizado**, disponíveis para revisão independente. O diagnóstico integrado de bordas corresponde ao mesmo AUIR01, sem abrir achado duplicado. Esta entrega não altera nem substitui a aprovação delimitada de AIBR01 e não aprova produção.

## AUIR01 — preservar afastamentos mantidos nas bordas

`import-replacement-client.ts` agora valida separadamente:

- **Delta alterado:** dias adicionados, retirados e atribuições alteradas continuam obrigatoriamente dentro do intervalo confirmado.
- **Dias mantidos:** podem estar fora desse intervalo, mas precisam estar dentro do horizonte técnico, com pessoa/matrícula correspondentes à base canônica e uma atribuição ABSENCE já existente naquela pessoa/data. Não basta a resposta dizer que o dia pertence à filial.

Não foram retiradas verificações de contexto, contrato, revisão, hashes, contagens ou identidade. A mesma validação é usada na prévia e no resumo de APPLY. Foram preservadas as negativas para delta fora do recorte, dia mantido fora do workspace, pessoa desconhecida, matrícula divergente e suposto dia mantido que não existe como afastamento na base conferida.

O sucesso real do teste cliente→rota/serviço confirma aceitação do workspace salvo, em vez de rejeitar indevidamente o resumo depois da gravação. A adoção pelo hook foi conferida no navegador com respostas sintéticas: revisão seguinte adotada uma vez, remoção interna aplicada e dias das bordas preservados. O tratamento de resultado verdadeiramente incerto não foi alterado: continua exigindo recarga/conferência, sem promessa de rollback ou retry automático.

## AUIR02 — erro e foco no campo realmente inválido

`import-replacement.tsx` passa a identificar os problemas de início e término separadamente. As mensagens são associadas ao Field correspondente; o foco ocorre após a atualização do DOM, no primeiro campo com erro.

| Situação | Campo sinalizado/focalizado |
| --- | --- |
| Somente término vazio | Data final |
| Somente término fora do horizonte | Data final |
| Somente início inválido/fora do horizonte | Data inicial |
| Ambos vazios | Ambos sinalizados; foco inicial |
| Datas válidas, término anterior ao início | Data final, com mensagem sobre a ordem |
| Intervalo maior que 42 dias | Data final, orientando reduzir a duração |

Um problema residual no contexto do comando não é atribuído a uma data válida: usa o resumo de erro e orienta recarregar o planejamento. A invalidação da prévia/aceite e o foco dos erros de ações explícitas permanecem preservados. Não houve redesenho, mudança de CSS ou de nomes acessíveis dos campos.

## Regressões antes da correção

Antes de alterar as duas fontes de produto, a prova integrada foi promovida dos artefatos autorizados para o teste permanente `web/src/components/escalas/import-replacement-boundary.test.ts`. O adaptador mantém identidade inicial/persistência simuladas, mas usa cliente, POST, autorização corrente, parsers, reconciliação, hashes, serviço e tratamento HTTP reais.

O fetch do cliente é encaminhado diretamente ao POST e devolve sua mesma Response. O clone serve somente às asserções. Não é reconstruído JSON de prévia/resumo/workspace para acomodar o cliente. O caso de APPLY conserva a continuação diagnóstica do teste original para exercitar também a rejeição pós-gravação; exige que a prévia e o resumo sejam aceitos e compara o input retornado com o efetivamente salvo pelo adaptador.

Resultado anterior (`red.log`): **3 falhas / 14 sucessos**, em três arquivos. Falharam a aceitação pura do dia mantido na borda e os dois casos reais PREVIEW/APPLY com bordas. Os controles completos, fontes FPRE136 parciais e isolamento já passaram.

No navegador anterior (`red-browser.json`), fim vazio, fim acima do máximo e intervalo invertido focalizavam o início; o sucesso com bordas era bloqueado. Os controles de início fora do limite e ambos vazios já focalizavam o início. Foram preservados relatório e capturas dessa fase, sem converter expectativas em aprovação do defeito.

## Verificação final

**28 testes aprovados em quatro arquivos**, por execução dirigida:

- Nove casos permanentes de fronteira: fonte completa no modelo de equipe; FPRE136 completo com páginas contíguas; FPRE136 começando em 2 e com salto 1→3; ABSENCES PREVIEW/APPLY com bordas; controle sem bordas; negativa de fetch externo; relatório de afastamentos com período insuficiente, mesmo após declaração.
- Oito testes do cliente, incluindo limites do delta e identidade dos mantidos, hashes, contagens, cancelamento, prazo e conflito.
- Nove casos de apresentação/validação de datas, incluindo o direcionamento correto dos erros.
- Dois autotestes do isolamento existente: acesso a Prisma não simulado e socket/fetch externo são bloqueados. O runner reutiliza `outputs/escalas-admin-import-backend/isolation.setup.ts` e seu teste; não inicializa banco nem servidor HTTP.

Fontes completas retornaram revisão seguinte e input canônico igual ao persistido no adaptador. Fontes parciais mantiveram blocker/negativa de APPLY e zero transação. O cenário real de bordas manteve 30/11 e 01/01, retirou apenas 02/12 e incluiu 04/12; contagens e hash da conferência permaneceram coerentes.

**Lint e tipos dos cinco arquivos alterados/adicionados passaram**, sem correções automáticas. `git diff --check` passou no recorte. Não houve repetição de quality/build global.

**Sete cenários finais de navegador passaram**, com componentes, hook e CSS reais e servidor sintético, em 390×900: término vazio; término fora do limite; início fora do limite; intervalo invertido; ambos vazios; prévia/APPLY com bordas; erro explícito de consulta. Datas inválidas não enviam pedido. O cenário de bordas mostra dias mantidos fora do recorte, envia um único APPLY e adota a revisão 4, preservando as duas bordas. O erro de consulta continua focalizando o resumo e não altera a revisão. Todos sem erro de página ou transbordamento horizontal.

As capturas finais de término vazio, término fora do limite e prévia com bordas foram abertas e conferidas visualmente. A fixture de navegador é uma cópia própria da anterior, com base e resposta sintéticas coerentes contendo os dias das bordas; não modifica artefatos de entregas anteriores. O cenário adicional de erro explícito foi acrescentado na fase final para preservar esse critério de foco; os seis casos comuns mantêm as mesmas expectativas entre vermelho e verde.

## Evidências, reprodução e limites

Em `outputs/escalas-admin-import-ui-fixes/`: teste/logs vermelho e verde, relatórios/capturas de navegador, scripts, fixture e manifesto de hashes. Para repetir os testes dirigidos, criar uma pasta própria com `task-temp.ps1 -Action New`, então executar `red-green.cjs green <pasta-própria>` com o Node do ambiente. A configuração reutiliza os guardas aprovados e coloca o cache nessa pasta. A expectativa vermelha é histórica; sobre o código corrigido a mesma suíte deve passar.

Fontes de produto corrigidas: cliente e componente de substituição. Testes alterados: cliente, apresentação e novo teste permanente da fronteira. `import-replacement-integration.test.tsx` não foi criado; a integração de adoção foi conferida pelo hook real no navegador e pela comparação cliente→rota/serviço no teste permanente. Nenhum resultado é atribuído a um arquivo inexistente.

Contrato r2 permanece `3474f9a284ed13e1feded265984c0348eba3543a94b94684c6c11b0666ca78bc`. Backend, parsers, SAVE, hook, montagem, catálogo, CSS global e polimento de linguagem anterior não foram alterados. O manifesto confere referências congeladas relevantes, inclusive serviço/rota/FPRE136 aprovados e as duas fontes do catálogo.

Persistência simulada não comprova PostgreSQL, locks, rollback ou concorrência real. O navegador não chama o backend real: a fronteira real é exercitada em processo nos testes isolados. Não houve autenticação externa, banco, E2E real, Python/Solver, instalação, produção, commit, push ou deploy. Shell/fontes do Next, zoom real de 200% e leitor de tela permanecem fora desta verificação focal.

Orientações de UI/UX Pro Max, Impeccable e frontend já aplicadas foram mantidas, com foco na recuperação correta do erro e sem redesenho. Context Mode foi efetivamente usado por `ctx_execute` para análise, conferência das provas e hashes; edições por `apply_patch` nativo.

Próxima ação: revisão independente deste delta e fechamento integrado autorizado. Recursos liberados após a conferência final. Processos próprios do navegador encerrados em `finally`; pasta temporária própria concluída pelo helper com saída zero e removida. Evidências persistentes foram preservadas fora dela; nenhum processo compartilhado foi encerrado.
