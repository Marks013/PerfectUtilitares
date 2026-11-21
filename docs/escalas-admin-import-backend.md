# Importação administrativa substitutiva — backend

`AUX-ADMIN-IMPORT-BACKEND r1`, despacho `AUX-ADMIN-IMPORT-BACKEND:r1:batch210`, gate210/reserva211, 14/11/2026. Checkout `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

## Plano da implementação

1. Validar/liberar o contrato aditivo de comandos, impacto, blockers e respostas.
2. Classificar a completude dos parsers de forma estruturada, preservando prévias legadas.
3. Reconciliar no servidor com IDs e impacto determinísticos; integrar ao SAVE uma intenção interna restrita, com CAS e revalidação na mesma transação.
4. Exercitar sucesso e negativas por purpose/ação com serviços/autorização reais e persistência simulada, preservando reprodução, logs e hashes.

Plano de origem conferido: SHA-256 `22b9b0474aeddccf277b4eec34d3485a11aa3f698b00e5e6784bbdb5a9cff0b0`. Não haverá UI, schema/Prisma, contrato de acesso/turnos, Solver, instalação, banco, produção, commit ou deploy.

## Contrato mínimo

Marco de contrato **r2**: AIC01 atendido por `layout: ESCALA_TEMPLATE | FPRE136 | FPHI105 | UNRECOGNIZED`, obrigatório na prévia e no resumo. A classificação acompanha o digest da conferência; não é inferida só pela extensão. `UNRECOGNIZED` acompanha fonte bloqueada sem interpretação reconhecida. Cinco casos de contrato e dois autotestes de isolamento aprovados. SHA-256 de `import-sync-contracts.ts`: `3474f9a284ed13e1feded265984c0348eba3543a94b94684c6c11b0666ca78bc`. Escrita do contrato novamente encerrada e liberada para consumo. Hook/model permanecem liberados, sem reabertura.

`lib/escalas/import-sync-contracts.ts` exporta `importSyncCommandSchema`, tipos de comando, `ImportSyncPreview`, `ImportSyncPreviewResult` e `ImportSyncApplyResult`. Transporte fechado para a UI: nas ações novas, multipart contém **somente** `file` (File CSV/XLSX) e `command` (JSON de ImportSyncCommand), uma ocorrência de cada. Booleanos são valores JSON reais. Comando malformado/duplicado, chave extra no multipart/DTO ou ação avulsa são rejeitados; nunca recaem silenciosamente na prévia antiga. O fluxo legado permanece sem `command`/`action`. O contrato não recebe equipe, empresa, aprovação, regime, força ou intenção interna do SAVE pelo navegador.

PREVIEW_REPLACE recebe purpose, workspaceId, expectedRevision, startDate/endDate e completeScopeConfirmed. APPLY_REPLACE acrescenta confirm:true/expectedImpactHash e exige completeScopeConfirmed:true. A prévia responde `{preview}`; confirmação responde `{workspace,summary}`. Datas técnicas do workspace e intervalo substituído são separados no contexto. Cobertura distingue declaração administrativa de período de relatório; a declaração não remove blockers nem comprova automaticamente completude.

O impacto expõe listas completas de pessoas adicionadas/atualizadas/removidas/inalteradas, dias ABSENCE incluídos/retirados/inalterados, mudanças de atribuição e referências antes/depois. Contagens e efeito sobre DRAFT, recálculo e aprovação acompanham o mesmo digest. Novos IDs e a representação do impacto serão determinísticos; o hash não autoriza a operação.

Blockers têm códigos fechados em `IMPORT_SYNC_BLOCKER_CODES`; warnings distinguem avisos da fonte, correspondência numérica legada, vínculo desconhecido e fora de escopo. A UI exibe o retorno do servidor e não reconstrói autoridade a partir do resumo.

Marco de contrato r1 validado: quatro casos de contrato e dois autotestes de isolamento aprovados. Escrita de `import-sync-contracts.ts` encerrada e liberada para consumo; mudanças posteriores exigem reconciliação. Leituras de `use-escalas-workspace.ts` e `workspace-model.ts` explicitamente encerradas e liberadas: o backend não voltará a lê-los. Endpoints ainda em implementação; esse marco não declara o APPLY entregue.

## Entrega do backend

Implementação concluída no clone, sem publicação. `import-sync.ts` executa a reconciliação a partir do workspace autorizado, com identificação determinística de novos vínculos, matrícula textual e preservação dos IDs/históricos dos correspondentes. Campos ausentes da origem não recebem os defaults do parser sobre fatos existentes. FPRE136 fornece somente os campos efetivamente presentes; escolhas manuais e definições antigas de turno são preservadas, com bloqueio para conflitos protegidos. Vínculos comprovadamente fora do intervalo permanecem na equipe. Equipe exige o horizonte técnico completo.

FPHI105 compara dias ABSENCE somente no intervalo declarado e sustentado pelo período do relatório. Retira dias antigos ausentes, acrescenta novos e conserva objetos ABSENCE idênticos, inclusive seus bloqueios. Remoção deixa célula vazia, sem restaurar WORK. Colisões com feriado/trabalho protegido, ambiguidades, origem parcial, desconhecida ou vazia impedem todo o lote. Correspondência numérica legada aparece como aviso, sem reescrever a matrícula. Os campos médicos e os nomes da fonte de afastamentos não saem do parser. A classificação de layout é feita pelo reconhecimento real dos parsers, antes da análise das linhas: cabeçalho reconhecido sem registros ainda informa o layout, mas permanece bloqueado; fonte não reconhecida informa UNRECOGNIZED.

`service.ts` recebeu a intenção interna estreita `adminImport`. Ela não existe no contrato HTTP genérico de SAVE. Exige administrador/import.manage, não combina com publicação, prova de Solver, catálogo, inclusão de modelo ou rebase. A única exceção de preservação retira ABSENCE existente, dentro do intervalo conferido e ausente do resultado. WORK e datas fora do escopo não podem ser alvos dessa exceção.

APPLY repete parser, correspondência e digest, e usa a única transação do SAVE existente. Depois do lock de acesso, repete capacidades, verifica a revisão alvo e recalcula impacto/candidato/aprovação com o cliente transacional, antes de CAS, revisão e auditoria. O digest inclui layout, bytes, extensão, contexto canônico, escopo, cobertura, impacto, candidato, autoridade e referência aprovada. A auditoria registra finalidade, escopo, hashes e contagens; não grava arquivo, nomes, matrículas ou dados médicos. Resposta final repete autorização. Revisão/impacto obsoletos retornam 409; impedimentos conferidos retornam 422. Revogação antes de escrever impede alteração; negativa depois do commit não é apresentada como rollback.

Sucesso cria uma nova revisão DRAFT. Mudança de cenário/fatos marca a geração pendente e limpa fingerprints; alteração protegida desassocia aprovação incompatível. Nome isolado preserva aprovação e não dispara recálculo. O serviço não aprova, gera nem publica automaticamente.

## Verificação executada e limites

- **229 testes aprovados em 10 arquivos; um caso excluído da seleção**, `carries real Python-shaped`, sem execução de Solver Python. A suíte nova de importação exercita serviço, parsers, autorização e HTTP reais, com identidade inicial e persistência simuladas. Há sucesso PREVIEW/APPLY para EMPLOYEES e ABSENCES, além de transporte legado na suíte de rota existente.
- Conferidos IDs/digest repetíveis, substituição A/B por B/C, defaults FPRE136, histórico/liderança, matrícula com zeros e alfanumérica suportada pelo parser, fallback numérico/ambiguidade, períodos/bordas, registros protegidos, aprovação preservada/invalidação/revogação, criação DRAFT a partir de publicação, CAS e corrida de revisão antes da escrita.
- Falhas simuladas em criação de revisão e auditoria restauram todos os estados do adaptador de teste. Isso comprova a integração com a transação simulada; **não comprova rollback, locks ou concorrência no PostgreSQL real**.
- Transporte testa command JSON inválido/nulo, duplicata, campos extras, booleano inválido e ação fora do comando, sem fallback legado. Isolamento bloqueia Prisma não simulado e conexões/socket/fetch; os dois autotestes passaram.
- Biome lint de 14 arquivos e TypeScript delimitado aprovados. Logs: `outputs/escalas-admin-import-backend/tests.log`, `lint.log`, `types.log`; reprodução por `verify.cjs`, fontes exatas em `sources.sha256`. Contrato r2 permanece no hash registrado acima.

Quality/build globais, Compose, migrações, banco e E2E de navegador não foram executados nesta reserva. UI não foi alterada; seu consumo e o fluxo completo de rascunho/autosave continuam no gate de integração. Não houve instalação, mudança de segredos, commit, push ou deploy. Fontes desta entrega ficam liberadas para leitura/revisão; mudanças posteriores exigem reconciliar os hashes. Hook/model permaneceram liberados, sem reabertura. A conferência dos dois P2 anteriores está separada em `docs/escalas-access-review.md` e não foi usada como conclusão desta importação.
