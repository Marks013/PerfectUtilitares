# Importação administrativa substitutiva — plano de execução

`AUX-ADMIN-IMPORT-PLAN r1` · despacho `AUX-ADMIN-IMPORT-PLAN:r1:batch198` · gate198/reserva199 · 14/11/2026. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`. Somente planejamento; única escrita deste despacho: este documento.

## 1. Resultado e diferença para o código atual

Implementar substituição confirmada de colaboradores **ou** afastamentos no escopo administrativo conferido. Acrescentar novos, atualizar presentes e retirar ausentes; não alterar outras filiais, workspaces/períodos ou revisões históricas. Matrícula permanece texto, sem remover zeros ou unir vínculos por nome. Arquivo parcial ou vazio inválido não autoriza remoção.

| Fonte atual | Já funciona | Falta para substituição |
| --- | --- | --- |
| `api/escalas/import/route.ts:25–70` | Modelo, CSV/XLSX limitado, prévia de pessoas/FPHI105, origem, capacidade administrativa e filial | Só devolve `{preview}`. Não recebe revisão canônica, não calcula remoções nem persiste importação. A equipe enviada pelo navegador para afastamentos não pode ser autoridade do futuro APPLY. |
| `lib/escalas/import.ts:48–106`, `fpre136.ts:34–88` | Parser, filial FPRE136, matrícula textual, classificações e referências | Linhas inválidas podem virar issues enquanto outras entram na prévia. Aviso não prova arquivo completo. FPRE136 não informa admissão/carga individual; seus defaults não são fonte desses fatos. |
| `components/escalas/import-reconciliation.ts:18–81` | Correspondência exata, conflitos, IDs e decisões individuais preservados | É aditivo: mantém pessoas ausentes e permite escolher quais atualizações/horários aplicar. Não serve como confirmação de sincronização completa. |
| `lib/escalas/fphi105.ts:39–111`, `absence-merge.ts` | Datas, interseção, diagnóstico, supressão de dados médicos e preservação de bloqueios | Merge nunca remove ABSENCE antigo. Períodos conflitantes e linhas inválidas podem coexistir com resultado parcial. Empresa/tipo do arquivo não certificam filial; sem linhas não significa escopo vazio validado. |
| `absence-import.tsx:143–158` | Prazo/cancelamento e invalidação por contexto; prévia antes da aplicação | Muda somente rascunho local, anuncia preservação de afastamentos e orienta gerar/salvar depois. Precisa confirmar a substituição persistida, com remoções visíveis. |
| `use-escalas-workspace.ts:79–104,117–125,153–171,213–231` | Fila de SAVE, flush, CAS, recuperação e adoção de revisão canônica | Importação não pode passar por `update`/autosave antes da confirmação. Reusar `run`, `flushDraft` e `acceptWorkspace` para uma operação administrativa explícita. |
| `lib/escalas/service.ts:323–431` | Comparação canônica, aprovação, bloqueios, CAS e revisão/auditoria transacionais | SAVE bruto não é prova de importação; preservação atual impede remover certos registros bloqueados. Necessária intenção interna estreita para o delta substitutivo, sem relaxar SAVE/APPLY genéricos. |

`api/escalas/[id]/route.ts` e `components/escalas/workspace-helpers.ts` não existem. Leitura/SAVE reais estão em `api/escalas/route.ts`; o bridge `mergeImport` está em `workspace-model.ts:284–285`. Não é necessário inventar outra rota de workspace.

## 2. Escopo e regras do delta

**Pessoas:** operar sobre um workspace salvo e sua filial canônica. A primeira fatia exige o horizonte técnico completo do workspace, não só o mês visível: remover uma pessoa do array afeta toda a proposta. Recorte mensal menor que esse horizonte não pode excluir o cadastro inteiro. Exibir e confirmar as datas técnicas, inclusive bordas de outros meses; se a fonte não cobre esse universo, bloquear substituição de equipe. Outros workspaces, mesmo da mesma filial, ficam intactos.

Comparar registros por matrícula textual e vínculo não ambíguo. O universo substituível contém os vínculos que intersectam o horizonte; cadastros comprovadamente fora dele são preservados. Manter ID da pessoa correspondente; novos IDs são resolvidos no servidor e conferidos contra colisões. Atualizar apenas campos efetivamente fornecidos pela fonte: nome, setor, cargo e referência importada; admissão, carga individual e regra dominical somente quando explicitamente presentes e válidas. Não copiar defaults do parser sobre contrato/histórico existente. Preservar fatos, liderança manual, preferências e campos administrativos não representados no arquivo. Conflito com escolha manual/horário protegido é bloqueio a resolver, não atualização parcial silenciosa.

Retirar os ausentes da equipe-alvo e suas atribuições na nova revisão, sem referências penduradas. Se isso atingir trabalho/feriado/decisão protegida, bloquear o lote até resolução administrativa explícita pelo fluxo existente. Não oferecer um `force` genérico. Históricos e publicações anteriores continuam nas revisões antigas; não inventar desligamento ou data de fim de vínculo. Manter definições de turno ainda referenciadas, inclusive por escolhas manuais/histórico; não limpar catálogo global ou podar turnos por aparência de desuso.

**Afastamentos:** não altera equipe, matrícula, regime ou definições. A cobertura é uma filial e um intervalo explícito contido no workspace, até 42 dias. O período do relatório precisa sustentar o intervalo; não usar o primeiro/último afastamento encontrado como prova da abrangência. Exemplo: relatório 01–31/12 não autoriza apagar ABSENCE de 30/11 ou 01–03/01 nas bordas da proposta.

Recalcular a equipe de correspondência no servidor e validar cada dia contra o vínculo canônico; a lista atual de ID/matrícula do parser não faz essa validação completa. Admissão desconhecida continua desconhecida, sem data fabricada. Resultado novo substitui o conjunto ABSENCE do escopo, inclusive retirando dias antigos ausentes no arquivo confirmado. Remover ABSENCE não restaura WORK/OFF anterior: a célula fica sem atribuição, pendente de conferência/geração explícita. Incoming ABSENCE pode substituir planejamento não protegido; colisão com feriado ou outro registro protegido bloqueia o lote. A exceção interna para retirar ABSENCE antigo, inclusive bloqueado, deve corresponder exatamente à substituição administrativa conferida; fora desse delta, preservar as guardas atuais. Não tratar ABSENCE como férias: o parser não conserva classificação canônica suficiente.

FPHI105 usa correspondência textual exata e fallback numérico de legado quando único (`fphi105.ts:77–86`). Não transformar isso em igualdade geral de matrículas nem gravar matrícula sem zeros. Expor a correspondência de fallback na prévia, exigir conferência e bloquear ambiguidades entre pessoas, empresas, contratos ou vínculos; não eleger o primeiro. Outras filiais/linhas não podem ser classificadas como irrelevantes sem contexto de origem verificável.

## 3. Validade e completude antes de remover

Separar problemas estruturados que **bloqueiam substituição** de avisos que preservam um registro válido. Bloquear layout/linha incompleta, matrícula duplicada ou ambígua, erro de leitura, contagem incompatível, origem indeterminada no escopo, período conflitante, falha de vínculo ou perda de registro na interpretação. Não decidir por substring de `issues.message`. MISSING/UNTIMED reconhecido pode manter a pessoa no universo; não equivale a pessoa ausente nem autoriza horário fictício.

Exibir abrangência detectada e a parte declarada pelo administrador. Arquivo bem formado não prova, sozinho, que a exportação está completa. Quando o layout não comprovar completude, exigir declaração administrativa específica de cobertura integral e revisão de todas as remoções; essa declaração não elimina blockers nem será descrita como verificação automática. Arquivo identificado como parcial não pode ser convertido em completo por checkbox.

Arquivo vazio, só cabeçalho, filial sem registros ou resultado vazio após descartar linhas inválidas: `canApply:false`, zero escrita. Na primeira fatia, não limpar integralmente a equipe/afastamentos com resultado zero. Uma futura limpeza por relatório completo legitimamente zerado exige marcador/total de origem reconhecido e caso real de teste; esse suporte não existe hoje e não deve ser inventado para aceitar um CSV vazio.

## 4. Contrato mínimo na rota existente

Estender multipart de **POST `/api/escalas/import`** com duas ações explícitas, preservando a prévia antiga sem ação e o GET do modelo:

| Ação proposta | Entrada mínima | Saída |
| --- | --- | --- |
| `PREVIEW_REPLACE` | `purpose:EMPLOYEES|ABSENCES`, arquivo, `workspaceId`, `expectedRevision`, intervalo solicitado; declarações de cobertura aplicáveis | Contexto canônico, finalidade/layout, hash do arquivo, impacto completo, blockers/avisos, `canApply`, `expectedImpactHash`, consequência para aprovação/grade. Nada persistido. |
| `APPLY_REPLACE` | Mesmo arquivo/contexto, `expectedImpactHash`, `confirm:true` e confirmação específica da cobertura | Workspace/revisão efetivamente persistidos, resumo do delta e efeito de aprovação/recálculo. Sem retornar só sucesso de rascunho local. |

Escopo, regime e equipe-base vêm do workspace autorizado. Campos do navegador não escolhem empresa, ator, IDs finais, dados médicos, aprovação ou delta autorizado. Rejeitar flags/JSON extras que tentem impor isso. Reusar limites de arquivo/multipart, validação de formato/conteúdo e rate limit; definir limites de textos/IDs pelos contratos canônicos, sem truncar identidade.

Reenviar o mesmo arquivo no APPLY evita tabela de uploads, armazenamento de arquivo ou migração. O servidor repete parser e reconciliação; compara hash do arquivo e hash determinístico do impacto, incluindo finalidade, contexto/revisão, escopo/cobertura, correspondências, campos alterados, remoções, conflitos e efeito da aprovação. O hash enviado não concede autorização nem substitui os dados canônicos. Não criar infraestrutura de job/manifesto/HMAC só para essa etapa. Mudança de arquivo, finalidade, contexto, revisão, aprovação relevante ou efeito exige nova conferência.

Prévia deve listar inclusões/atualizações/inalterados/**remoções**, mudanças de referência e atribuições afetadas por categoria, correspondências ambíguas, fora do escopo, conflitos e resultado da aprovação. Contagens são do lote completo, não da página visível. Confirmar “Substituir equipe/afastamentos de [filial] em [datas]”, com quantidade/lista de remoções; não oferecer seleção parcial de pessoas para depois chamar o resultado de substituição integral.

## 5. Persistência, aprovação e concorrência

1. Antes de conferir, concluir ou resolver o rascunho pendente pelo `flushDraft`; conflito/recuperação/proposta gerada não aplicada exige decisão explícita. Importação não deve apagar esse trabalho para obter uma revisão limpa.
2. No servidor, exigir `import.manage` e acesso de gravação à filial na entrada e na confirmação transacional. Resolver usuário/política atuais; revogação antes da escrita impede alteração. Reautorizar antes da resposta. Revogação depois de commit pode negar resposta, mas não equivale a rollback.
3. Adicionar serviço delimitado em `lib/escalas/import-sync.ts` que reconcilia no servidor e constrói uma intenção interna do delta. Integrar essa intenção ao SAVE existente: exceção apenas para remoções/substituições canônicas da importação confirmada, com nova verificação dentro da transação. Não aceitar essa intenção no corpo genérico de SAVE nem usar `serverEnrollment`/prova de Solver como atalho.
4. Usar uma única transação de gravação: lock de acesso existente, revalidação da referência/revisão/aprovação, conferência final do impacto, `updateMany` com empresa/id/revisão, criação de `EscalaRevision` e auditoria. Não envolver o SAVE atual em outra transação aninhada. Qualquer falha reverte todo o delta; nunca aplicar só linhas válidas ou só inclusões antes de descobrir conflito de remoção.
5. Produzir nova revisão **DRAFT**, nunca sobrescrever/publicar revisão antiga. Se partir de uma publicação, mostrar na prévia que será criada revisão de rascunho e preservar a publicada como histórico. Demais workspaces e histórico factual dos correspondentes não são reimportados. Mudança de regime/equipe/referência/fatos protegidos desassocia a aprovação incompatível, conforme a regra existente; nome isolado não deve invalidar aprovação por conveniência. Nenhuma importação aprova automaticamente outro snapshot ou faz ADMIN_REBASE implícito.
6. Se o delta afeta geração/cobertura, marcar desatualizado e limpar fingerprints pertinentes usando as funções existentes; não aceitar `needsRegeneration:false` do navegador. Preservar a grade remanescente como proposta pendente, sem completar lacunas ou executar Solver. Nova aprovação/rebase/geração/publicação continuam ações próprias.
7. Retornar 409 em revisão/impacto obsoleto, sem retry destrutivo automático. A fila do hook fica suspensa na operação; sucesso usa `acceptWorkspace`, não `update` seguido de um segundo SAVE com base antiga. Resultado incerto por rede exige recarregar/conferir a revisão; o CAS impede repetir a gravação sobre a mesma base. Auditoria registra finalidade, ator, alvo, hashes e contagens, sem conteúdo do arquivo, nomes/matrículas ou campos médicos.

## 6. Arquivos e sequência de entrega

| Fatia | Arquivos a reservar na implementação |
| --- | --- |
| Backend/contrato e parser | Novo `lib/escalas/import-sync.ts` e teste; `import.ts`/test, `fpre136.ts`/test e `fphi105.ts`/test somente para classificação estruturada/completude efetivamente necessária. Não duplicar parsers. |
| Backend/HTTP e transação | `api/escalas/import/route.ts`/test; `lib/escalas/service.ts`/test para a intenção interna e invariantes. Não precisa editar `api/escalas/route.ts` se o APPLY continuar na rota de importação. Sem Prisma/migração. |
| UI de prévia/impacto | `import-changes.tsx`, `import-reconciliation.ts`/test, `absence-import.tsx`/test e bridge `workspace-model.ts`. Exibir delta do servidor; retirar mensagens “ausência não exclui ninguém” e “preserva todos os afastamentos” do fluxo substitutivo. Não transformar a reconciliação do cliente em autoridade de escrita. |
| UI de persistência | `use-escalas-workspace.ts`: flush/bloqueio/commit/adoção da revisão e invalidação por sessão, arquivo, alvo ou revisão. Conservar cancelamento/prazo e ignorar resposta atrasada. |
| Ponto de montagem pendente | Localizar e reservar o chamador que conecta `ImportChanges`/`mergeImport` ao formulário de equipe. Seu conteúdo não foi lido neste escopo; fazer busca focal desses símbolos em `components/escalas` e liberar os chamadores antes de despachar a fatia UI. Não presumir que alterar apenas o componente de conferência elimina o caminho aditivo antigo. |

Congelar primeiro a extensão mínima de requisição/impacto e a matriz de blockers. Depois, backend e UI podem avançar com propriedade separada; a UI não apresenta “substituição salva” enquanto o endpoint não persistir o contrato. Integrar pelo hook com um único escritor e testar o fluxo completo antes da liberação.

## 7. Testes exigidos na execução futura

| Grupo | Casos decisivos |
| --- | --- |
| Pessoas | Equipe A/B, arquivo B/C completo: remove A, mantém ID/histórico de B, atualiza campos comprovados e acrescenta C; outra filial/workspace inalterados. `0007`, `7`, alfanuméricos e vínculos ambíguos; defaults FPRE136 não sobrescrevem carga/admissão/regra real. |
| Afastamentos | Conjunto antigo de dias versus novo: inclui e retira exatamente dentro do intervalo; bordas fora do relatório intactas; remoção não restaura WORK fictício. Vínculo, término aberto, múltiplas linhas e dados médicos não devolvidos/persistidos. |
| Bloqueios/segurança de fonte | Parcial/truncado detectado, linha inválida, duplicata, período divergente, marcador de filial ausente, vazio/só cabeçalho e zero após filtros: sem remoção/escrita. Conflitos protegidos abortam todo o lote. Declaração de completude não ignora blockers. |
| HTTP e autoridade | Sucesso real PREVIEW/APPLY para os dois purposes, serviço/autorização reais e persistência simulada; não-admin, filial/ID trocado, input/flags forjados, arquivo alterado e revogação antes/durante/final. Guardar a distinção entre rollback transacional e negativa depois do commit. |
| CAS/histórico/aprovação | Editor muda revisão entre prévia e APPLY: 409; falha de criação de revisão/auditoria reverte a operação; repetição não duplica efeito. Revisões/publicação antigas e outros períodos preservados; invalidação/rebase da aprovação corretos, sem gerar/publicar automaticamente. PostgreSQL concorrente exige validação real posterior. |
| UI/regressão | Autosave em andamento, conflito, arquivo/purpose/filial/revisão trocados, dois cliques, timeout/cancelamento e resposta tardia; removidos visíveis e confirmação vinculada ao impacto. Atualizar o teste que hoje exige manter ausentes (`import-reconciliation.test.ts:57`) e os testes de merge aditivo somente para o novo fluxo, preservando guardas. |

Reusar Vitest nativo e a barreira já comprovada contra Prisma não simulado/sockets/fetch, sem `.env`. Rodar testes dos arquivos alterados e tipos/lint delimitados; quality/build e E2E real apenas no gate de integração autorizado. Não se propõe executar nada nesta etapa de planejamento.

## 8. Evidência e liberação das leituras

Leitura/análise por `ctx_batch_execute` e `ctx_execute`, efetivamente disponíveis e validados; patch nativo somente neste plano. Dezessete fontes foram consolidadas, com agregado SHA-256 `bcebf8e75ca7c44e35981c117011efeeb292014dcf515646bbb04b717ad226c2`: ordenar os pares `[caminho relativo, SHA-256(bytes)]` por caminho e calcular SHA-256 do JSON compacto UTF-8. Fontes centrais do corte:

| Fonte | SHA-256 |
| --- | --- |
| `api/escalas/import/route.ts` | `9cd7875146093c72b40fe78a622f3d0ca6a27e206c833c4450fe95ac483c9dfc` |
| `use-escalas-workspace.ts` | `30e552df01183027c3b6cbda2bfebcfa12ec8bd50c3e3acf256466188f6b14df` |
| `import-reconciliation.ts` | `41e052beb3c9fdc3e57d65976359b64519f49af975f619e06ac176f16416cd65` |
| `lib/escalas/fphi105.ts` | `5e294191cf2421cf0ec0d6004c5fe30c82779e09eccbfb3db22141ac79b65fb9` |
| `lib/escalas/service.ts` | `b989e008b3e27db091e8280079f20b2f9a4f7b00d0357515ee011f0cac67dcd5` |

Não houve teste, importação de aplicação/Prisma, banco, rede, Solver, dependência, migração, código alterado ou processo de apoio. Nenhum descartável foi criado; não há temporário próprio a concluir. Plano não certifica cobertura completa dos arquivos de origem nem autoriza aplicar pacote antigo. As leituras deste despacho, especialmente `use-escalas-workspace.ts`, ficam liberadas ao entregar; o chamador UI ainda exige identificação/liberação explícita antes da implementação.
