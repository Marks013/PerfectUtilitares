# Bônus e domingos opcionais na Antecipação Salarial

Na aba **Antecipação Salarial** do módulo Reajuste, a opção **Incluir diferenças de bônus e domingos** permite apurar os eventos 565 e 901 a partir das mesmas folhas mensais já importadas. A opção começa desativada e não modifica a operação normal da antecipação. Não existe uma terceira aba para os eventos.

Importe de uma a quatro folhas detalhadas no padrão `MM-AAAA.xlsx`, informe o percentual restante da antecipação e, se desejar os adicionais, ative a opção e configure os valores. A conferência identifica quem recebeu cada evento, os meses com pagamento, os meses sem o evento e as competências em que o colaborador não aparece na folha. Relatórios tabulares de INSS continuam aceitos na antecipação sem a opção; quando os eventos são incluídos, são necessárias folhas detalhadas com rubricas. O FPRE131 continua na aba Reajuste Salarial.

## Configuração e cálculo

Informe o valor unitário anterior e, quando desejar calcular diferenças, o novo valor do bônus 565 e/ou da indenização 901 por domingo. Os campos novos podem ficar vazios para apenas identificar os pagamentos. Se o valor anterior mudou entre meses, configure a exceção histórica na competência correspondente. As configurações pertencem à sessão de trabalho e podem ser alteradas em reajustes futuros; as planilhas não são alteradas.

Os valores anteriores começam em R$ 80,00 para o bônus e R$ 85,00 por domingo. Os valores novos começam vazios e a inclusão dos eventos começa desativada. A antecipação mantém a base `INSS Proc`, inclusive quando o relatório reúne a base mensal e a base de 13º. Informe o percentual geral no campo próprio; no cenário conferido de junho a agosto de 2026, ele foi de 1,08%.

O cargo exato **Embalador a mão**, após normalização de acentos, espaços e prefixo numérico, usa um percentual separado, inicialmente **2,2655%**, configurável com até quatro casas decimais. Outros cargos, inclusive **Embalador à mão / Padaria**, usam o percentual geral. O cálculo arredonda para centavos por colaborador e competência antes de somar os totais.

As situações **Lic. s/ Remuneração**, **Demitido**, **Aposent. Invalidez** e **Detenção** bloqueiam antecipação, diferença do bônus e diferença de domingos somente na competência em que aparecem. Pagamentos e quantidades originais continuam registrados para conferência, com diferenças a pagar zeradas. Relatórios tabulares antigos sem situação ou cargo mantêm compatibilidade e recebem um aviso no PDF para revisão da elegibilidade e dos percentuais; as folhas detalhadas fornecem esses dados por colaborador.

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

A prévia dos eventos possui busca, filtros por filial, competência e presença do evento, além de paginação. A diferença exibida por colaborador soma somente as competências visíveis; os cartões gerais identificam expressamente os totais dos eventos em todas as bases. A filial de agrupamento corresponde à última competência em que o colaborador consta nas bases, inclusive quando houve transferência. Trocar arquivos ou valores invalida a prévia; Limpar e a mudança de aba cancelam requisições em andamento.

Após **Apurar eventos**, o único botão **Gerar PDF** produz um documento com três seções: resumo consolidado por colaborador, detalhamento da antecipação e detalhamento dos eventos. O total a pagar é a antecipação mais somente as diferenças de bônus e domingos; os pagamentos antigos não são somados novamente. O documento contém todas as bases e colaboradores, independentemente dos filtros da conferência, e possui numeração única do começo ao fim. O servidor recalcula a apuração completa, confrontando competências, matrículas, nomes, presença mensal e totais antes da geração.

Os arquivos ficam limitados a 10 MB cada, 20 MB no conjunto e quatro competências; os limites de expansão XLSX, linhas e 5.000 colaboradores únicos também são aplicados. A seleção que excede quatro arquivos é recusada integralmente com aviso, preservando as bases e a apuração anteriores. O cabeçalho precisa identificar a empresa antes dos colaboradores; folhas de empresas diferentes não podem ser combinadas. Código, nome, empresa e filial aceitam até 512 caracteres por identificador, para manter importação e paginação previsíveis, sem truncamento silencioso. Autorização do módulo, origem, limites de requisição e capacidade de processamento são verificados nas APIs de importação. Não há gravação das planilhas ou dos nomes em uma nova base de dados.

## Fundamentação técnica

O leiaute oficial [eSocial S-1200, itens de remuneração](https://www.gov.br/esocial/pt-br/documentacao-tecnica/leiautes-esocial-versao-s-1-3-nt-06-2026/index.html#r_1200_dmDev_infoPerApur_ideEstabLot_remunPerApur_itensRemun) distingue quantidade, fator e valor total da rubrica. A apuração preserva essa distinção; os códigos de evento locais não definem, por si, o número de domingos.

A [especificação ECMAScript, divisão BigInt](https://tc39.es/ecma262/2026/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-bigint-divide) define divisão inteira. Por isso, o cálculo verifica o resto antes de aceitar a quantidade e evita arredondar pagamentos incompatíveis.

As duas abas usam associação entre `tab` e `tabpanel`, foco na aba ativa e navegação por setas, Home e End, conforme o [padrão de abas WAI-ARIA do W3C](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/). Quebras de linha e espaços repetidos em identificações são normalizados na apresentação do PDF para manter os blocos dentro da área útil.
