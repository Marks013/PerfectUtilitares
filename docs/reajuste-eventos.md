# Apuração dos eventos 565 e 901

A aba **Eventos 565 e 901**, no módulo Reajuste, importa de uma a quatro folhas mensais detalhadas no padrão `MM-AAAA.xlsx`. A análise identifica quem recebeu cada evento, os meses com pagamento, os meses sem o evento e as competências em que o colaborador não aparece na folha. As bases INSS e FPRE131 continuam nos fluxos próprios do módulo.

## Configuração e cálculo

Informe o valor unitário anterior e, quando desejar calcular diferenças, o novo valor do bônus 565 e/ou da indenização 901 por domingo. Os campos novos podem ficar vazios para apenas identificar os pagamentos. Se o valor anterior mudou entre meses, configure a exceção histórica na competência correspondente. As configurações pertencem à sessão de trabalho e podem ser alteradas em reajustes futuros; as planilhas não são alteradas.

O cálculo usa centavos inteiros. A quantidade só é confirmada quando o pagamento é um múltiplo exato do valor anterior. Uma referência positiva preenchida na folha precisa concordar com essa divisão. No layout mensal utilizado, a referência zero do evento 901 é um marcador sem quantidade; a apuração usa então a divisão exata pelo valor anterior. A quantidade de domingos não pode ultrapassar os domingos do calendário da competência.

Para cada evento e mês:

```
quantidade = valor pago / valor unitário anterior
valor recalculado = quantidade × novo valor unitário
adicional = máximo(valor recalculado − valor pago, zero)
```

Exemplos:

| Evento | Pago | Valor anterior | Novo valor | Quantidade | Adicional |
| --- | ---: | ---: | ---: | ---: | ---: |
| 565, em um mês | R$ 80,00 | R$ 80,00 | R$ 90,00 | 1 | R$ 10,00 |
| 901, em um mês | R$ 170,00 | R$ 85,00 | R$ 90,00 | 2 domingos | R$ 10,00 |
| 901, em um mês | R$ 255,00 | R$ 85,00 | R$ 90,00 | 3 domingos | R$ 15,00 |

Três competências com bônus de R$ 80,00, reajustado para R$ 90,00, geram R$ 30,00 de adicional. Um novo valor menor não gera desconto automático.

## Conferência

Os códigos 565 e 901 são identificados numericamente dentro do bloco individual do colaborador, encerrado pelo marcador `INSS Proc:`. Resumos de filiais e da empresa são excluídos. Matrícula identifica o colaborador; conflitos de nome, duplicidade de matrícula e estrutura incompleta interrompem a importação.

Divisão inexata, referência incompatível, quantidade fracionária, lançamento duplicado ou excesso de domingos ficam como pendências, sem diferença calculada para o item. A prévia continua disponível para conferência. O PDF só é liberado sem pendências e com ao menos um novo valor informado. Sugestões de valores anteriores mostram sua evidência e precisam ser aplicadas pelo usuário: o menor pagamento ou divisor comum pode representar vários domingos e não prova o valor unitário.

A prévia possui busca, filtros por filial, competência e presença do evento, além de paginação. O PDF apresenta configurações, quantidades, valores pagos/recalculados, diferenças por mês, subtotais por filial e total geral. Trocar arquivos ou valores invalida a prévia; Limpar e a mudança de aba cancelam requisições em andamento.

Os arquivos ficam limitados a 10 MB cada, 20 MB no conjunto e quatro competências; os limites de expansão XLSX, linhas e 5.000 colaboradores únicos também são aplicados. Autorização do módulo, origem, limites de requisição e capacidade de processamento são verificados nas duas APIs. Não há gravação das planilhas ou dos nomes em uma nova base de dados.

## Fundamentação técnica

O leiaute oficial [eSocial S-1200, itens de remuneração](https://www.gov.br/esocial/pt-br/documentacao-tecnica/leiautes-esocial-versao-s-1-3-nt-06-2026/index.html#r_1200_dmDev_infoPerApur_ideEstabLot_remunPerApur_itensRemun) distingue quantidade, fator e valor total da rubrica. A apuração preserva essa distinção; os códigos de evento locais não definem, por si, o número de domingos.

A [especificação ECMAScript, divisão BigInt](https://tc39.es/ecma262/2026/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-bigint-divide) define divisão inteira. Por isso, o cálculo verifica o resto antes de aceitar a quantidade e evita arredondar pagamentos incompatíveis.
