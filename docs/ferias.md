# Conferência administrativa de férias

## Escopo

Recebe o modelo XLSX mensal de férias e devolve o mesmo documento preenchido nas colunas F:H. Acesso exclusivo a contas ADMIN ativas, limitado ao tenant da sessão. Nenhum arquivo, relatório ou cópia de base é persistido.

O módulo não altera o cálculo de exclusão da Unimed, seus documentos, importadores ou competências. Também não executa o VBS nem utiliza Access ou Office COM.

## Regras

- A competência solicitada é sempre o mês/ano do início das férias. Cadastro e fatura/coparticipação da Unimed usam essa competência quando ambas estão publicadas; se a base Unimed estiver incompleta, usam juntas e exclusivamente a competência imediatamente anterior. O Consignado Digital nunca usa fallback: precisa estar publicado exatamente na competência das férias.
- A mensalidade do titular vem da tabela vigente nessa competência. Somam-se as mensalidades dos dependentes e, separadamente, ADITIVO presente na fatura. Procedimentos de coparticipação, pro-rata, carteirinhas e descontos não integram a coluna de mensalidades do VBS.
- Consignado independe de haver cadastro Unimed. Somam-se as parcelas publicadas daquele mês, sem recalcular juros ou proporcionalidade.
- Ausência de benefício em fonte publicada não equivale a fonte ausente. Dados não publicados, identidade inconsistente ou tabela necessária indisponível impedem exportação.
- Matrícula e nome concordantes permitem identificação do titular. CPF válido permite relacionar empréstimos; uma correspondência somente pelo nome exige confirmação administrativa. Não usar buscas parciais ou valores enviados pelo navegador.
- Duração é inclusiva em dias corridos, entre 1 e 30 dias. Períodos acima de 30 dias são recusados como provável erro de digitação e nunca são corrigidos automaticamente. Férias inferiores a 30 dias recebem destaque. Para 30 dias, destacar somente quando começarem a partir do segundo dia útil do mês.
- Sábados, domingos e feriados aplicáveis em Umuarama/PR não são úteis. Ponto facultativo não é automaticamente feriado. O calendário inicial revisado cobre 2026; outros anos exigem atualização versionada e testes.

## Arquitetura e integridade

- `src/lib/ferias/`: contratos, calendário, identidade, repositório, cálculos, XLSX e processamento limitado.
- `/admin/ferias`: upload, prévia, confirmações e download.
- `POST /api/admin/ferias/analisar`: análise sem persistência.
- `POST /api/admin/ferias/exportar`: releitura das fontes, validação da revisão e exportação.
- PostgreSQL: leitura curta em `RepeatableRead`, filtrada por tenant. A competência atual e a anterior são localizadas em uma consulta; Cadastro e Fatura usam sempre a mesma competência selecionada, enquanto Consignado permanece na atual. Consultas em lote, sem N+1. Limite inicial de 20.000 registros por conjunto consultado, com falha explícita acima disso.
- Revisão SHA-256 vincula fontes, preços, regras/calendário, arquivo e confirmações. Alteração das fontes entre prévia e exportação devolve conflito; o usuário precisa analisar novamente.
- Capacidade distribuída de duas operações, limites de upload/ZIP/linhas, cancelamento da transformação e proteção global de recursos. Dados pessoais não são registrados em logs.

## Preservação do modelo

A dependência proposta inicialmente, ExcelJS, foi substituída por `@xmldom/xmldom@0.9.12` e o ZIP já existente no projeto. A alteração estruturada apenas das partes necessárias do OOXML evita incorporar a árvore antiga do ExcelJS e reduz transformações no layout original.

Preservar conteúdo A:E, linhas vazias, ordem, numeração, mesclagens, dimensões, margens e impressão. Recalcular F:H, incluindo limpeza de resultados antigos. Estilos de negrito devem ser clonados sem contaminar outras células. Fórmulas, macros, entidades XML externas e relações externas não fazem parte do contrato aceito.

XLSX é a saída desta entrega. PDF permanece evolução opcional pelo worker de conversão existente, condicionada à comparação visual, sem um segundo layout independente.

## Calendário e fontes

O calendário combina feriados nacionais com os municipais confirmados, incluindo Paixão de Cristo, Corpus Christi, 26/06, 15/08 e 04/10. As fontes municipais apresentam divergência sobre Corpus Christi: a comunicação municipal confirma o feriado pela Lei 2.046/1997; não copiar indiscriminadamente classificações de ponto facultativo de servidores.

- [Decreto municipal 027/2026](https://umuarama.pr.gov.br/files/Atos/arquivo/decreto%20-%201770298375.pdf)
- [Prefeitura: Corpus Christi em 2026](https://umuarama.pr.gov.br/noticias/administracao/umuarama-ter-feriado-na-quinta-4-e-ponto-facultativo-na-sexta-feira-5)
- [Prefeitura: datas originais dos feriados religiosos](https://www.umuarama.pr.gov.br/noticias/administracao/corpus-christi-e-feriado-em-umuarama-e-sexta-feira-sera-ponto-facultativo)
- [Parser XML: documentação oficial](https://github.com/xmldom/xmldom)

## Release

Executar testes focados das regras, fonte/tenant, rotas, worker, calendário e fidelidade do XLSX. Depois, gate nativo de qualidade, build de produção único e smoke do serviço. Não versionar anexos pessoais nem relatórios gerados. Recuperação por commit anterior, sem reversão de dados, pois o módulo não cria migrations nem altera benefícios.
