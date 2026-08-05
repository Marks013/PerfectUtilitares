# Reconciliação Unimed — competência 07/2026

Auditoria executada em 31/07/2026 sobre os arquivos reais de beneficiários,
faturas e endereços. O analisador emite somente totais e motivos agregados;
nomes, CPF, matrículas, cartões e endereços não são exibidos nem persistidos.

## Resultado

| Medida | Antes | Depois | Decisão |
| --- | ---: | ---: | --- |
| Itens de fatura sem beneficiário | 16 | 16 | manter sem vínculo |
| Pessoas distintas nesses itens | 13 | 13 | cadastro atual não contém candidato |
| Dependentes sem titular | 1 | 1 | manter sem vínculo |
| Registros somente no banco de endereços | 499 | 499 | informativo: não possuem plano Unimed |
| Beneficiários com `planCode` único | 0 persistidos | 560 | preencher |
| Beneficiários com `planCode` ambíguo | não detectado | 1 | `null` e aviso |
| Beneficiários sem item conciliado | não detectado | 1 | `planCode = null` |

O conjunto contém 562 beneficiários, 910 itens válidos de fatura e 776
endereços válidos. Não houve linha rejeitada. Foram ignoradas 389 linhas de
totalização da fatura e 23 linhas vazias da base de endereços.

## Causas confirmadas

Os 16 itens sem conciliação possuem CPF válido na fatura, mas os 13 CPF
distintos não existem no cadastro de beneficiários da competência. Também não
há candidato pelo nome normalizado. Seis itens possuem matrícula, porém nenhuma
delas encontra beneficiário. Os casos estão distribuídos em seis filiais.

O dependente sem titular não possui item de fatura conciliado. Também não há
titular único na mesma filial com a mesma matrícula, nem relação determinística
entre os códigos de origem. A ordem das linhas e similaridade de texto não são
evidência suficiente para criar o vínculo.

Portanto, reduzir `16` ou `1` com os arquivos atuais exigiria associação
ambígua. Esses valores são divergências reais entre fontes, não falha de
normalização.

## Regras determinísticas

Para itens de fatura:

1. CPF informado só associa quando existe exatamente um beneficiário com esse
   CPF. CPF ausente, desconhecido ou duplicado não permite fallback por nome.
2. Sem CPF, matrícula única dentro da mesma filial pode associar.
3. Sem CPF e sem matrícula única, nenhuma associação é criada por nome.
4. Qualquer ausência ou ambiguidade mantém `beneficiaryId = null`.

Para titulares de dependentes, continua obrigatório nome normalizado exato e
único na mesma filial porque a origem informa apenas o nome do titular. Essa
associação serve somente para estruturar o grupo familiar. Para endereços, CPF
único tem prioridade; sem CPF, somente matrícula global única pode associar.
Nome isolado nunca associa endereço.

O banco de endereços é complementar: não cria beneficiário, plano, preço,
aditivo ou cobrança. Após uma associação segura, sua matrícula substitui ou
completa a matrícula de pesquisa do beneficiário. Plano e cálculo continuam
derivados exclusivamente das bases de beneficiários e coparticipação.

O `planCode` do beneficiário é derivado somente dos itens já conciliados. Um
único código não vazio é persistido. Zero códigos ou mais de um código distinto
resultam em `null`; conflito gera `ambiguousPlanCodes`.

## Bloqueio e aviso

Bloqueiam publicação:

- linha rejeitada por campo obrigatório, CPF/CNPJ, data, categoria ou valor
  inválido;
- arquivo sem estrutura obrigatória;
- filial de beneficiário sem CNPJ válido;
- ator sem permissão ou lote concorrente/idempotente ainda em processamento.

Não bloqueiam, mas geram aviso agregado:

- item de fatura sem beneficiário;
- dependente sem titular;
- endereço sem beneficiário;
- mais de um `planCode` para o mesmo beneficiário.

Essa política é compatível com 07/2026: preserva os itens financeiros sem
inventar vínculos. Campos relacionais ou códigos ambíguos ficam nulos e podem
ser revisados posteriormente.

## Verificação

- `npm test -- src/lib/unimed/reconcile.test.ts src/lib/unimed/importer.test.ts`
  — 10 testes aprovados.
- `work/analyze-unimed-reconciliation.ts` — auditoria reproduzível com saída
  exclusivamente agregada.
