# Revisão do contrato de importação substitutiva

## Conclusão vigente — r2

`AUX-ADMIN-IMPORT-CONTRACT-REVIEW r2` · despacho `AUX-ADMIN-IMPORT-CONTRACT-REVIEW:r2:batch231` · gate231/reserva232 · 14/11/2026.

**Resultado: APROVADO no recorte do DTO. AIC01 encerrado.** O contrato congelado r2 adiciona `importSyncLayoutSchema`, com `ESCALA_TEMPLATE`, `FPRE136`, `FPHI105` e `UNRECOGNIZED`, e exige `layout: ImportSyncLayout` em `ImportSyncPreview`. O consumidor dispõe agora de classificação estruturada, distinta da finalidade e das mensagens. O estado não reconhecido representa a impossibilidade de identificar o layout sem inventar uma classificação válida.

A conferência foi limitada a esse delta; os demais limites e ressalvas da análise r1 abaixo permanecem. A presença obrigatória no tipo e o enum não comprovam que o backend emitirá o valor correto, bloqueará fonte desconhecida ou incorporará a classificação ao hash quando relevante. Isso será verificado no lote funcional; nenhum parser, serviço ou teste em edição foi lido ou executado.

Evidência: leitura nativa de dados por `ctx_execute` e hash SHA-256 do contrato r2 `3474f9a284ed13e1feded265984c0348eba3543a94b94684c6c11b0666ca78bc`, reconferido ao concluir. O coordenador informou sete testes com saída zero; não foram repetidos ou certificados independentemente nesta revisão. Alteração somente neste parecer por `apply_patch`.

Próxima ação: seguir para a verificação funcional da emissão/consumo do layout e do impacto. Contrato e leituras liberados. Nenhum descartável, processo, recurso externo, commit ou deploy foi criado.

## Histórico preservado — r1

`AUX-ADMIN-IMPORT-CONTRACT-REVIEW r1` · despacho `AUX-ADMIN-IMPORT-CONTRACT-REVIEW:r1:batch220` · gate220/reserva221 · 14/11/2026.

**Resultado: REJEITADO quanto à completude do DTO previsto no plano**, por uma omissão P3 delimitada abaixo. Não foi demonstrado outro problema no contrato. A conclusão não certifica parser, autorização, transação, persistência ou consumidor UI.

## AIC01 — P3 — Prévia não identifica o layout reconhecido

`web/src/lib/escalas/import-sync-contracts.ts:43–55` representa finalidade, contexto, cobertura, hashes, impacto e efeito, mas não o layout detectado. O plano exige finalidade/layout na saída de PREVIEW_REPLACE (`docs/escalas-admin-import-sync-plan.md:49`) e abrangência detectada distinta da declaração administrativa (linha 39).

Efeito no consumidor: a UI consegue mostrar “colaboradores” ou “afastamentos”, mas não consegue informar, com autoridade do servidor, qual layout foi reconhecido. Teria de omitir essa informação ou inferi-la de extensão, nome de arquivo ou mensagem de aviso. Finalidade e layout são informações diferentes; `fileHash` também não identifica o formato interpretado.

Delta mínimo: incluir na prévia um campo estruturado de layout reconhecido, com os valores dos layouts efetivamente suportados pelo produtor, e um estado explícito de não reconhecido quando a prévia bloqueada não conseguir determiná-lo. Não inventar suporte a layouts novos. A UI deve exibir o valor vindo do servidor; mensagens de problemas continuam texto de orientação, sem virar protocolo de detecção. Incluir a classificação no impacto/hash caso possa mudar a interpretação. A alteração pertence ao produtor; nenhum contrato foi editado nesta revisão.

## Demais limites e representações

- Identificador: 1–100 caracteres e mesma classe de caracteres canônica. O schema de comando não aplica o `trim` usado em `schema.ts:7`; assim rejeita entradas periféricas em vez de aceitar uma identidade diferente. IDs canônicos continuam representáveis.
- Datas: reutiliza `isDate`, que valida data real e formato entre 1900 e 2099. Ordem e duração inclusiva de até 42 dias estão expressas corretamente. O input canônico de planejamento restringe seu horizonte a 2000–2099 e semanas completas; conter o intervalo no workspace e exigir horizonte completo para EMPLOYEES são verificações contextuais do serviço, não demonstradas pelo schema comum. O intervalo de afastamentos pode ser menor que uma semana completa.
- Revisão: inteiro positivo limitado a 2 bilhões. Não foi encontrado limite numérico de revisão conflitante nas fontes canônicas autorizadas; CAS e igualdade com a revisão salva exigem verificação no servidor.
- Comando: união discriminada e objetos estritos distinguem PREVIEW/APPLY. APPLY exige `confirm:true`, cobertura confirmada e hash SHA-256 em formato hexadecimal. Empresa, ator, IDs finais e delta não são entradas controladas pelo navegador. A presença dessas confirmações não pode eliminar blockers de fonte parcial ou inválida.
- Impacto: listas completas de pessoas adicionadas/atualizadas/removidas/inalteradas, dias de afastamento, atribuições antes/depois e referências antes/depois suportam apresentação de remoções e consequências. Registro de pessoa inclui ID, matrícula textual e nome. `fields` informa os campos alterados; o contrato não promete valores anteriores/novos de todos esses campos.
- Cobertura e bloqueios: separa intervalo solicitado, período detectado e declaração; expõe fonte parcial, identidade, vínculo, duplicidade, proteção e demais bloqueios. `canApply`, blockers e contagens permitem desabilitar a confirmação e apresentar os motivos. A detecção correta desses estados permanece responsabilidade da implementação.
- Aprovação: efeito inclui DRAFT, necessidade de regeneração, invalidação e versões de política antes/depois. APPLY devolve workspace canônico e resumo; não representa apenas sucesso de alteração local.

## Evidência e liberação

Contrato conferido integralmente e estável ao final: SHA-256 `bdaa5429571a131244eae2b34e9d1d0a9e2589545d10ab4f59a61ac2d9f5b2de`. Comparação com `types.ts`, `schema.ts`, `dates.ts`, plano e parecer de desenho, exclusivamente dentro das leituras autorizadas. Análise efetiva por `ctx_execute`; edição nativa por `apply_patch`.

O coordenador informou seis testes aprovados em `contract.log`; esse arquivo e os testes não foram lidos nem executados, conforme o escopo. Não são apresentados como verificação independente deste parecer. Não houve leitura de parsers/service em edição ou montagem UI, nem rede, banco, aplicação, dependência, subagente, commit ou deploy.

Próxima ação: produtor resolver AIC01 ou coordenador registrar explicitamente a redução do requisito de layout; depois conferir somente o delta do DTO. Leituras liberadas. Nenhum descartável ou processo foi criado; não há temporário próprio a concluir.
