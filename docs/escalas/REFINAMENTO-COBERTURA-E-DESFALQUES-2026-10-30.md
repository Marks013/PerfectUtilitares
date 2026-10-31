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

A implantação e a identificação final das imagens são registradas no fechamento desta etapa.
