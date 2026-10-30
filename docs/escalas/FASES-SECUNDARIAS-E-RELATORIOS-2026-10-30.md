# Escalas — fases secundárias e relatórios, 30/10/2026

Estado: concluído e implantado no servidor. Validação direcionada em produção, sem ambiente isolado, novas bibliotecas ou alteração de credenciais.

## Auditoria e correções

1. A divisão geométrica do tempo deixava estabilidade e outras metas sem execução. Uma primeira distribuição proporcional foi rejeitada na validação real: mais fases eram tentadas, mas continuavam UNKNOWN e a cobertura dominical perdia tempo útil.
2. A solução final mantém cobertura prioritária, cobertura dominical e equilíbrio de domingos. As demais metas compartilham um único presolve na fase SECONDARY_POLISH. Cada objetivo é limitado ao próprio valor anterior: nenhum pode piorar para beneficiar outro. A busca usa pesos inteiros limitados a 1–1000 e até 18 pessoas de um setor prioritário no horizonte inteiro. Não equivale a uma otimização lexicográfica completa.
3. A telemetria registra uma duração conjunta e valores individuais em members. Objetivos no piso comprovado dispensam busca; unattemptedObjectives não confunde objetivos incluídos no grupo com objetivos não executados. O cliente rejeita membros duplicados, aninhados, ausentes ou com piora declarada.
4. Preparação reduzida com hints em lote, fixação somente das decisões e cache dos domínios do modelo original, local à chamada. Clones não compartilham limites alterados. Presolve, cancelamento, guards e o orçamento configurado de 12 segundos foram preservados.
5. A filial 08 expôs uma divergência adicional: a interface inferia novembro em uma revisão mensal antiga, mas o Solver exigia visibleMonth explícito. A inferência Python agora segue exatamente o contrato de datas TypeScript, inclusive anos virados e fevereiro bissexto. Horizontes genuinamente semanais não recebem mês inventado; nenhum JSON salvo foi reescrito.
6. XLSX: separadores mesclados removidos apenas da região de dados, permitindo filtros e ordenação coerentes. Metadados continuam mesclados fora do filtro; seleção ativa, congelamento e áreas de impressão foram conferidos. Período em dd/MM/aaaa.
7. PDF: identificação do tipo de relatório e período legível; espaço calculado para manter setor, cabeçalho e primeira pessoa na mesma página. Conteúdo extenso continua sendo dividido sem truncamento. Cores existentes preservadas após conferência visual.

A cobertura por setor continua protegida tanto no mês apresentado quanto no horizonte completo, inclusive aos domingos. Mínimos explícitos, ausências, bloqueios, regras individuais e continuidade não foram flexibilizados.

## Rodada prática final

Uma geração por planejamento na versão final, usando PostgreSQL protegido em modo somente leitura. Nenhuma proposta foi salva. Comparação com as grades salvas usando as mesmas demandas estimadas; valores em pessoas-minuto, não quantidade de funcionários.

| Plano | Total visível, antes → depois | Domingos visíveis, antes → depois | Redução dominical |
| --- | ---: | ---: | ---: |
| 07 | 113.572 → 100.388 | 26.326 → 15.244 | 42,1% |
| 08 | 60.071 → 52.310 | 12.635 → 7.173 | 43,2% |
| 11 | 55.883 → 49.845 | 6.876 → 4.665 | 32,2% |

| Plano | Total no horizonte, antes → depois | Domingos no horizonte, antes → depois |
| --- | ---: | ---: |
| 07 | 165.378 → 142.080 | 35.404 → 19.356 |
| 08 | 86.072 → 73.614 | 14.951 → 8.735 |
| 11 | 78.238 → 69.314 | 7.740 → 4.915 |

Nos 31 grupos setoriais avaliados, nenhuma piora em total ou domingos, no mês visível ou no horizonte completo. Todos retornaram FEASIBLE, validação independente válida e zero ERROR. As 120 ausências do plano 11 foram preservadas. Não existiam bloqueios nas três grades reais; bloqueios foram exercitados no E2E técnico.

### Execução das metas secundárias

- 07: polimento FEASIBLE, 1,910 s; equilíbrio de sábados 28.336 → 25.003; distribuição 7.826 → 7.796; rodízio 4.900 → 4.856; pessoas alteradas 62 → 61; estabilidade 412 → 408. Desempate também melhorou.
- 08: polimento FEASIBLE, 2,068 s; distribuição 5.550 → 5.528; rodízio 3.178 → 3.132; pessoas alteradas 56 → 55; estabilidade 428 → 426. Sábados mantidos e desempate melhorado.
- 11: equilíbrio de domingos 1.667 → 0; polimento FEASIBLE, 1,140 s, sem ganho adicional nos membros. Não foi alegada melhoria inexistente.

Nenhum objetivo ativo ficou em unattemptedObjectives. Isso comprova inclusão na busca, não melhoria ou otimalidade de todos os objetivos. As entradas reais não possuíam meta não nula de preferências; a preservação de preferências foi exercitada nas regressões, sem fabricar solicitações para as pessoas reais.

O tempo reportado pelo Solver foi 12,108 / 12,016 / 12,174 s; a chamada completa levou aproximadamente 17,6 / 15,8 / 16,2 s. O orçamento configurado continua em 12 s; encerramento, preparação da resposta, transporte e validação não são uma garantia de latência máxima de 12 s. As reduções da tabela são relativas às grades salvas, não uma promessa de superar toda execução anterior do algoritmo. São medições pontuais, não um benchmark estatístico.

## Validação dos arquivos e regressões

- 43 testes CP-SAT da otimização e três testes de escopo mensal aprovados no runtime existente.
- 21 testes do cliente e 29 testes de exportações aprovados. TypeScript, Biome sem erros, gate estrutural e git diff --check aprovados. Sem repetição da suíte global ou E2E isolado; CI não foi acompanhado.
- Revisão independente dos patches, sem bloqueadores confirmados.
- Comparação das 12 abas reais antes/depois, com o mesmo input, confirmou todos os registros e valores preservados: Escala/Horários/Desfalques/Excluídos = 136/136/1440/6 no 07, 76/76/717/5 no 08 e 86/86/924/6 no 11. As únicas remoções são as linhas separadoras, não pessoas nem ocorrências. Todas as abas mantêm três mesclas de metadados fora do filtro e seleção correta. Alturas máximas: 149 / 136 / 136 pontos, abaixo de 409.
- PDFs reais das grades salvas e das propostas foram extraídos com ferramenta independente. As propostas finais têm 23 / 15 / 17 páginas A4, zero palavras sobrepostas e zero palavras fora das margens verificadas. Preview visual conferido com nomes e matrículas mascarados. Não foi prometida redução artificial do número de páginas.
- E2E autenticado em produção aprovado em 32,9 s: criação técnica, edição, revisão, geração, aplicação e download de PDF/XLSX. O rascunho técnico foi removido; nenhum planejamento existente foi publicado.
- A impressão no Microsoft Excel não foi conferida manualmente. Estrutura, seleção, filtros, áreas de impressão e igualdade de dados foram verificados; a escala mensal permanece densa em papel A4.

## Implantação e integridade

Aplicação implantada em 6b472b0dc1b93d55243795ed8c7e3676746ce824; última otimização exclusivamente Python em ca401cbda02a2c60cd4793198eb6a5c0e0549b41. O último ajuste não exigiu rebuild da aplicação. O cliente compatível foi ativado antes do Solver com a nova telemetria.

- Aplicação: sha256:94c64f3ce7294a09ed83121322f2fa970e6168c8135aeff11b4b25433612d1f9.
- Solver: sha256:03e5720694e3ee7ebe8ca8b62a80363e49a1aa3c24eb2f3b9a6716a1eaa94f21.
- Manifesto final: 68c65648d6460bba11c19bdde1f3d2e2184d976b2935ac0f51cacca73f373455.
- Compose validado com acesso aos arquivos protegidos; quatro serviços saudáveis. Banco e worker de PDF não foram recriados. Fontes implantadas conferidas por hash.
- Quatro planejamentos e 44 revisões preservados; revisões de 07/08/11 continuam 17/21/5. Assinatura histórica antes/depois: 2afd220f8bbabfbc1311b257b6db05e7.

Evidências completas em /home/ubuntu/perfectutilitares-reports/escalas-secondary-2026-10-30, com permissões protegidas. Histórico das tentativas rejeitadas preservado separadamente de final-results.json e pdf-audit-final.json. Recuperação anterior ao cache: web-escalas-solver:rollback-secondary-404bc996c596, mantendo a aplicação atual. Imagens anteriores também preservadas. Não restaurar cliente antigo com Solver novo sem conferir compatibilidade da telemetria.

Ainda existem desfalques estimados. FEASIBLE não comprova ótimo global; um grupo sem melhoria não prova inexistência de uma solução melhor. Publicação dos planejamentos continua pendente de revisão operacional. Não foram inventadas demandas reais, preferências, autorizações ou garantias de conformidade.
