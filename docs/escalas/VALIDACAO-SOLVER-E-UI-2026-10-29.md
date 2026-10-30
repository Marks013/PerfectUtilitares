# Validação de solver, interface e exportações — 29/10/2026

Estado: implementação e verificação pré-implantação concluídas; implantação autorizada pelo usuário em 29/10/2026.

## Método

Dados originais FPRE136 (650 pessoas, sete filiais) e FPHI105, sem preparação artificial. Importadores e preparação TypeScript atuais, 42h, novembro de 2026 com horizonte técnico de seis semanas. O benchmark conserva bloqueios, restrições e ausências; não salva dados pessoais, chaves, nomes ou CID. Houve duas execuções por versão e filial (28 execuções). CPU limitada a dois núcleos por processo, sem rede e fonte somente leitura. O baseline é o solver do commit 43e28c5, alimentado com exatamente a mesma entrada preparada do corrigido.

Os 34 aprendizes do cargo explicitamente informado pela empresa ficam fora da alocação 5×2. Cadastro, referências importadas e registros protegidos são conservados. Há 33 registros de afastamento associados às equipes e 887 dias de ausência no horizonte agregado; todos preservados. Registros de outra filial não são associados pelo nome.

## Comparação observada

Descoberto é a soma dos minutos-pessoa de referência estimada não atendida, inclusive restrições específicas de cargo. Não equivale a demanda de vendas, vagas ou garantia de cobertura.

| Filial | Pessoas no arquivo | Aprendizes fora da geração | Descoberto anterior médio | Corrigido médio | Variação |
| --- | ---: | ---: | ---: | ---: | ---: |
| 02 | 62 | 2 | 148.664 | 140.354 | −5,59% |
| 06 | 121 | 6 | 188.229 | 174.080 | −7,52% |
| 07 | 143 | 6 | 217.669 | 214.060 | −1,66% |
| 08 | 81 | 5 | 119.551 | 116.527 | −2,53% |
| 11 | 92 | 6 | 139.593 | 136.056 | −2,53% |
| 16 | 53 | 3 | 77.713 | 74.592 | −4,02% |
| 18 | 98 | 6 | 161.212 | 153.240,5 | −4,94% |

Todos os 28 resultados foram FEASIBLE e passaram pelo verificador independente TypeScript, sem erros. Fases secundárias produziram soluções reais em todas as filiais: quatro por execução em 02/08/16, duas nas demais. Fases que esgotam o prazo permanecem identificadas como UNKNOWN, sem perda da proposta já viável. Estabilidade e preferências vazias não geram uma fase artificial; uma regressão separada com entradas não vazias comprovou a execução dos oito objetivos.

O indicador comparável de domingos usa a amplitude das taxas de domingos trabalhados por oportunidades disponíveis, agrupadas por setor, modo de horário, jornada e regra de domingo. Melhorou em seis filiais; na 07 subiu de 2.666 para 3.333 pontos agregados, enquanto o descoberto melhorou. O objetivo de equilíbrio inclui sábados e domingos; portanto não há promessa de melhora de todo subindicador em todas as filiais. Duas repetições não demonstram significância estatística nem determinismo universal.

## Alterações de algoritmo

- Modelo continua conjunto: o equilíbrio de lideranças entre setores não foi removido.
- Descanso passa a usar extremos de ocupação diária com restrições condicionais, em vez de pares de alternativas O(S²). Equivalência foi comparada a uma especificação independente enumerada, incluindo fronteiras e noturno.
- Intervalos estimados idênticos compartilham a mesma variável de descoberto; pesos de minutos somados conservam o objetivo original.
- Incumbente completo permanece disponível. UNKNOWN preserva a solução e permite aproveitar o restante do orçamento.
- Toda melhora incidental em prioridades anteriores é conservada pelas fases posteriores.
- Após cobertura, prioriza equilíbrio de fins de semana, concentração de folgas, rodízio, pessoas alteradas, estabilidade, preferências e desempate.
- Em modelos maiores, as fases secundárias trabalham em semanas móveis do mesmo modelo, fixando as demais datas ao incumbente. Todas as restrições de fronteira, cobertura e liderança permanecem. Ótimo desse recorte não é ótimo global; a resposta final continua FEASIBLE.
- Um worker, semente fixa e nome atual num_workers. Isso reduz fontes de variação, sem garantir igualdade sob qualquer carga e prazo.

## Horários, férias e intervalos

- As 24 referências 12:50–22:10 da filial 18 permanecem incluídas em simulação. Horas civis não são convertidas silenciosamente em crédito noturno nem certificadas como regularidade trabalhista.
- FPHI105 já era suportado e foi validado novamente. Férias não produzem PARTIAL_WEEK_PENDING por semana. A indisponibilidade é explicada uma vez por período.
- Corrigido trabalho após meia-noite invadindo ABSENCE do dia seguinte, tanto no Python quanto no verificador TypeScript. Bloqueio conflitante é preservado e retorna conflito, não substituído.
- Pausa interna acima de 120 minutos em jornada superior a seis horas gera aviso no rascunho. Uso estrito exige ajuste ou acordo específico com fonte, revisão, responsável, vigência e limite explícito. Um acordo genérico não é autorização automática.
- A opção de simular jornada acima de quatro e até seis horas sem pausa fica encontrável ao lado da jornada semanal. Não altera o mínimo das jornadas acima de seis horas nem representa autorização legal.

## Interface e documentos

- Horários agrupados por setor A–Z, sequência completa de horário crescente, cargo e nome A–Z.
- Quatro horários zerados do FPRE136 usam ENC (escala sem horário fixo). Não são inventadas horas nem cobertura por faixa. Ausência de processamento realmente distinta conserva indicação própria.
- Geração automática é a ação principal; ajustes manuais são opcionais. Informações de publicação e detalhes técnicos não competem com conflitos do rascunho.
- Atalhos de correção selecionam pessoa/dia ou setor/data/faixa reais e esperam o editor montar antes de focar.
- Cores discretas azul/cinza/lavanda, divisórias de dias e nomes. PDF A4 horizontal e XLSX com cabeçalho compacto, zoom 75% na grade/90% em horários, bordas e impressão A4.

## Evidência e limites

Antes do fechamento: 88 testes Python passaram; o caso adicional dos oito objetivos passou isoladamente. Testes focados TypeScript de backend, UI e documentos passaram. A suíte Python foi incluída no CI, que antes apenas construía a imagem.

Teste extremo independente com 250 pessoas, 42 dias e 12 alternativas retornou 10.500 atribuições FEASIBLE, em 14,513 segundos totais; iniciou CP-SAT em 9,663 segundos, com 183 mil variáveis e 76.500 restrições. O orçamento interno de busca é 12 segundos, mas serialização, construção e retorno acrescentam custo. Não se anuncia garantia de latência máxima de 12 segundos. Nas sete filiais reais, execuções corrigidas ficaram entre 11,608 e 12,117 segundos.

O segredo entre serviços e cancelamento cooperativo não foram alterados nesta etapa. O solver continua sem porta pública, em rede interna. Nenhum segredo de produção foi criado, substituído ou exposto para testes.

## Fechamento de validação

- Quality chamado uma vez. Prisma, tipos, lint,20 verificações operacionais e288 arquivos Vitest passaram:2.140 testes aprovados e3 condicionais ignorados. Cobertura:65,20% linhas,63,29% statements,59,27% funções e56,05% branches; gates não foram reduzidos.
- O gate parou por um benchmark sem comando npm registrado e um tipo exportado sem uso externo. Ambos foram corrigidos; etapas restantes foram retomadas sem repetir as suítes já aprovadas. Dead-code,377 módulos e73/73 rotas dedicadas com caminho2xx passaram.
- Rodada ampla de navegador:59 passaram,5 condicionais ignorados e5 falharam. Três dependiam de rótulo/abertura de controles alterados, uma revelou destino errado de mínimos obrigatórios (corrigido com regressão) e uma atingiu429 do rate limit de Unimed. Não foi afrouxada proteção.
- Reteste no bundle de produção: quatro dos cinco casos passaram; o controle de pausa exigia abrir a seção opcional, conforme o novo fluxo. Após corrigir a navegação do teste, uma rodada isolada nova com os CSV privados aprovou os cinco casos: importação/geração/exportação real, férias, proteção de registros, pausa curta e polimento.
- Novo teste de polimento verifica ordenação crescente, setores, ENC, ausência de aprendiz na grade de folgas, atalho de pausa, correção de cobertura e375/768/1280px. Nenhum dado real é capturado em screenshots/traces. Evidência visual foi obtida exclusivamente com pessoas sintéticas.
- PDF sintético A4 renderizado por Poppler e inspecionado; nomes, grades e desfalques permanecem dentro da página. XLSX aberto por leitores reais nos testes. A inspeção identificou verde herdado e linhas altas na UI; corrigidos com tokens próprios azul/lavanda e uma única expansão por pessoa.36 testes de interface, lint e tipos passaram após o polimento, exigindo atualização justificada do build.
- Build de produção passou. Compose validado com acesso aos arquivos protegidos, sem imprimir ou alterar segredos.
- Imagens de recuperação preservadas em web-{app,pdf-worker,migrate,escalas-solver}:rollback-polish-20261029. Fonte do fallback de solver foi comparada por hash ao baseline antes de rotular a recuperação. Banco e volumes não foram alterados por migração nesta etapa.

A revisão exata implantada e os health checks serão registrados após o comando de publicação. Push não foi autorizado nesta etapa e não será executado.
