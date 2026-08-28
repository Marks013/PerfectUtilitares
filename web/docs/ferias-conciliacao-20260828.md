# Unimed e Ferias: conciliacao e exportacao

## Escopo

- Busca Unimed aceita matricula numerica de um digito. Nomes continuam exigindo dois caracteres.
- Consignado do XLSX fica em H. A coluna I legada e removida da area de resultados.
- Matricula, nome normalizado e aliases existentes de filial reduzem confirmacoes manuais.
- Nome completo e CNPJ da filial podem confirmar consignado com identificacao bancaria nao comparavel a matricula do RH, somente quando o grupo tem CPF valido e nao e ambiguo.
- Divergencias de CPF/CNPJ e parcelas adicionais sem identidade confirmada bloqueiam a exportacao.
- Dependentes faturados sem cadastro sao conciliados somente com titular faturado, filial e familia inequivocos. Nenhum cadastro e criado ou alterado.
- Itens sem vinculo e sem nome do titular tambem sao examinados pelo nome da familia cadastrada, evitando omissao silenciosa.
- A revisao do resultado inclui os dados de filial e CNPJ; alteracoes invalidam exportacoes antigas.

## Competencias

Unimed pode usar a base completa do mes anterior quando a competencia solicitada ainda nao esta disponivel. Consignado exige a competencia exata das ferias. Ausencia de beneficio de uma pessoa nao equivale a ausencia da base obrigatoria.

## Evidencias

- Planilha de setembro fornecida pelo usuario: 47 colaboradores, 33 com Unimed, 14 com consignado, 12 destaques e zero pendencias de identificacao.
- Matricula 5: mensalidades de R$ 754,02 e acessorios de R$ 12,24, usando a base Unimed de agosto e tabela vigente.
- Exportacao repetida produz os mesmos bytes; leitura de retorno preserva as 47 linhas.
- LibreOffice abriu o XLSX e gerou duas paginas A4; primeira pagina inspecionada visualmente com o consignado em H.
- Suite geral: 1.137 testes aprovados e dois testes condicionais ignorados.
- Depois da revisao independente: 247 testes focados aprovados e um teste condicional ignorado.
- 17 testes E2E isolados aprovados, sem usar o banco de producao como banco de testes.
- TypeScript, lint sem avisos, verificacao de codigo morto, limites de modulos e cobertura de rotas aprovados.
- Os testes operacionais pendentes foram vinculados a `npm run test:ops` e ao comando `quality`.

## Limites

Nao ha correspondencia automatica aproximada por similaridade de nomes. Homonimos, CPF conflitante, filial contraditoria, cobrancas duplicadas e vinculos familiares inconclusivos continuam exigindo revisao. Confirmacoes manuais nao dispensam consistencia dos valores e das bases.

Nao foram alterados bancos de producao, configuracoes de acesso, precos ou dependencias nesta manutencao. O deploy deve registrar a revisao exata nos labels OCI e ser seguido por smoke autenticado de busca, analise e download.
