# Refinamento de cobertura e apresentação dos desfalques — 30/10/2026

## Alterações

O polimento conjunto passa a buscar explicitamente cobertura total e de domingos, além dos objetivos secundários existentes. Cada membro conserva seu teto, e as proteções de setor, domingo, horizonte e mês visível permanecem ativas. Não foram alterados ausências, bloqueios, carga, regras obrigatórias, dependências ou o orçamento configurado de 12 segundos.

A busca continua no modelo completo, incluindo liderança entre setores. Seleciona um setor com falta e pessoas alteradas, com até 36 participantes; cobertura dominical e total desempatam a escolha. Isso mantém parceiros que o antigo corte de 18 podia congelar. Demandas apenas em dias úteis também participam. Grupos sem empregados são ignorados. A ampliação simultânea para dois setores foi descartada porque a preparação consumiu a fase curta.

No PDF e XLSX, faltas são organizadas por setor A–Z e horário crescente, e cargos relacionados ficam juntos e em ordem alfabética. A ocorrência de um cargo não duplica a quantidade geral do setor. Fatos idênticos são deduplicados; diferenças reais de data, quantidade, base e horário são preservadas. O PDF reúne datas com a mesma falta, sem repetir uma linha apenas pela mudança da janela analisada. O XLSX mantém a janela em coluna própria, uma ocorrência por data e quantidades apenas na primeira linha de continuações longas. Filtros, seleção e áreas de impressão foram preservados. As grades seguem setor, horário proposto e nome A–Z; cargos não antecedem nomes no mesmo horário.

## Validação real de continuação

Foram usados os planejamentos correntes 07/revisão 17, 08/revisão 21 e 11/revisão 5. A referência de continuação foi uma proposta real da versão anterior para cada planejamento, e não uma equipe sintética. A nova busca recebeu essas atribuições como ponto de partida. Nada foi aplicado, publicado ou salvo nas grades originais.

Unidade: pessoas-minutos estimados em falta no mês apresentado.

| Filial | Total anterior | Total refinado | Redução | Domingo anterior | Domingo refinado | Redução |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 07 | 100.388 | 96.560 | 3,81% | 15.244 | 13.058 | 14,34% |
| 08 | 52.310 | 45.780 | 12,48% | 7.173 | 5.177 | 27,83% |
| 11 | 53.818 | 50.350 | 6,44% | 3.121 | 2.637 | 15,51% |

Não houve piora do total nem dos domingos em nenhum dos 31 grupos setoriais, tanto no mês quanto no horizonte completo, comparando com a proposta usada como base. As três propostas passaram no verificador independente. Os 120 registros de ausência da filial 11 foram preservados; não havia bloqueios individuais nessas grades reais. As regressões focadas também exercitam proteções de setor e domingo.

A fase conjunta retirou mais 2.017 pessoas-minutos no horizonte da filial 08 e 1.753 na 11, sem gastar resultados de seus outros membros. Na 07, a fase retornou UNKNOWN e manteve exatamente seu incumbent; os ganhos vieram das fases anteriores. Isso não foi registrado como falha de viabilidade ou prova de ótimo.

## Método e limites

A conferência ocorreu diretamente no servidor e no runtime de produção, sem ambiente de testes isolado, seed ou migração. A conexão de leitura confirmou `default_transaction_read_only=on`. O conjunto de quatro planejamentos e 44 revisões foi verificado antes e depois por SHA-256, sem mudanças.

Ensaios iniciais a partir da grade salva variaram com o término por tempo. Algumas alternativas perderam ganhos que a seleção antiga encontrava em outro setor; não foram usadas como evidência de melhora por setor. A tabela acima mede uma continuação das propostas anteriores, não um benchmark estatístico nem a garantia de que uma rodada nova será sempre melhor que qualquer execução passada.

As proteções comparam faltas agregadas por setor e período com o incumbent válido. Não garantem melhora de cada faixa individual. Ausências e demanda estimada podem impedir zerar as faltas. Estimativas não equivalem a mínimos operacionais confirmados. FEASIBLE não prova ótimo global; o limite de 12 segundos é do cálculo e pode ter pequeno custo adicional de parada, extração, transporte e validação.

## Evidências

- Testes Python focados: 52 aprovados, incluindo seis regressões novas de cobertura conjunta, seleção limitada, setores vazios e proteção de setor/domingo.
- Testes TypeScript de ordenação e exportação: aprovados nos arquivos afetados; relatórios reais conferidos separadamente.
- Nenhuma alteração em `.env`, segredos, banco, cadastros ou dependências.
- Dados e relatórios de prova estão em `/home/ubuntu/perfectutilitares-reports/escalas-coverage-refinement-2026-10-30`, com diretório 0700 e arquivos 0600; não contêm cópias de segredos.
- O gate completo e cenários alheios não foram repetidos, conforme o pedido de limitar testes aos fluxos afetados.

## Fechamento da implantação

Código implantado: `b2f2518dff36033314b055e23132e57ce9fb1be1`. Um único build de aplicação e Solver foi executado após as alterações; não houve rebuild de banco ou serviço de PDFs. Compose válido com acesso normal aos arquivos protegidos; TypeScript e whitespace aprovados. Quatro serviços saudáveis, banco e PDF-worker com os mesmos contêineres anteriores.

- Aplicação: `sha256:5303bb2bdd6c21974ce7a01d48dc76f4a28653468795364c52a133450f2c2c5e`.
- Solver: `sha256:602346e7848fe0a417c1f96106358520e9a63c3ae2184d77734f9a3767718cac`.
- Manifesto das fontes: `46b834a3f0342b21e7500cea9b71b81fa055c0dc158f409c2322885c40dd3a5d`.
- Os nove arquivos Python do runtime foram comparados por SHA-256 com as fontes implantadas.
- Recuperação preservada: `web-app:rollback-coverage-2224caa` e `web-escalas-solver:rollback-coverage-2224caa`; não é necessário reverter dados ou segredos.

Os três XLSX reais das propostas refinadas preservaram todas as ocorrências: 1.285/679/782 registros em 07/08/11, sem linha idêntica duplicada, falta de dados ou quebra da ordenação. Grades com 136/76/87 colaboradores permaneceram completas. Filtros contêm apenas registros, mesclagens ficam nas três linhas de metadados e seleção coincide com o painel utilizável.

Os PDFs completos das propostas refinadas têm 71/36/42 páginas A4 paisagem, sem texto fora dos limites conferidos nem caixas de texto sobrepostas. A primeira versão integral da mesma proposta 07 tinha 116 páginas: a compactação final removeu repetições de contexto, sem cortar grupos. A página real de desfalques também foi inspecionada visualmente. O PDF completo pode ser maior que o relatório antigo, que omitia grupos estimados após o corte de 24. XLSX foi lido por biblioteca independente; não houve conferência manual em Microsoft Excel ou LibreOffice.

Após a implantação, um novo cálculo real da filial 08 passou pelo cliente autenticado do Solver e pelo verificador independente, com todos os membros conjuntos protegidos. Pelo navegador, login administrativo normal, seleção de 07, geração e download de PDF/XLSX funcionaram; a grade salva corrente gerou PDF de 81 páginas, distinto do arquivo da proposta refinada acima. A tela de 390 px não apresentou overflow global. Nenhuma proposta foi criada, alterada ou publicada nesse smoke.

A assinatura final dos quatro planejamentos e 44 revisões permaneceu `b2936d9832e2caf3d80ba1a78eb8c9e469c81926f172c3ace94d0614835f5c59`. Evidências de build, implantação, geração, exportações e navegador estão no diretório protegido indicado acima. CI e navegação pública não foram acompanhados.
