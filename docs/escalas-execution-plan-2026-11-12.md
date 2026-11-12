# Escalas — plano integrado de execução

Data: 12/11/2026. Base inicial: `6f006accccef32add8ea12dec557751f1dceedce`.
Estado: REGISTRO PRÉ-RELEASE. Escopo e decisões consolidados; este arquivo não é uma fila ativa nem comprova implantação. A aprovação operacional depende do CI do SHA enviado e da evidência da implantação.

## Direção e segurança

Trabalho diretamente no servidor. Preservar registros originais, afastamentos, bloqueios, históricos e edições concorrentes. Não alterar produção por um conjunto parcialmente integrado. Commit, push e implantação somente após os gates abaixo. Não publicar grades automaticamente.

O planejamento foi ampliado pelas solicitações recebidas durante a implementação. Os testes já executados antes dessas inclusões não são aprovação das novas regras.

## Frentes, responsáveis e sequência

| Ordem | Assunto | Responsável técnico | Situação inicial desta consolidação |
|---|---|---|---|
| 1 | Contagem e qualidade das folgas | Backend TypeScript e Python | Implementado; testes focados aprovados; integração final pendente |
| 2 | Trocas entre colegas e busca do Solver | Backend TypeScript e Python | Implementado; validação do runtime novo pendente |
| 3 | Sábados sem folga regular | Backend de geração, verificador e Python | Integração em andamento |
| 4 | Importação, jornadas curtas e filiais 01/10 | Importação e preparação TypeScript | Exclusão implementada; diagnóstico do CSV real pendente |
| 5 | Três modos e interface contextual | Serviço de geração e UI | Em implementação |
| 6 | Ajuste automático de entrada/saída | Preparação e UI | Em implementação |
| 7 | Precisão dos desfalques por jornada, turno e faixa | Cálculo de cobertura e integração com UI/relatórios | Diagnóstico real concluído parcialmente; melhoria solicitada em implementação |
| 8 | Verificação, release e inspeção real | Integração principal | Aguardar conclusão das dependências |

As frentes 3–7 podem exigir regressões adicionais. Nenhuma deve ser considerada concluída apenas porque o código foi escrito.

## 1. Contagem única e frequência das folgas

- Meta: até dois pares por pessoa/mês, nunca uma quota a preencher.
- Reduzir também a quantidade total abaixo dessa meta, a concentração nas mesmas pessoas e a repetição em semanas consecutivas.
- Contar cada par uma vez, no mês da segunda folga, usando apenas bordas conhecidas.
- Separar pares impostos e ajustáveis. Não contar férias, afastamentos ou feriados como folga regular.
- Preservar opções explícitas de consecutivas e bloqueios; não transferir o problema ao próximo mês.
- Aceite: Python e TypeScript concordam sobre exemplos comuns; não aumentar excesso individual ou concentração em empate.

## 2. Busca e trocas seguras

- Ampliar a troca atômica de duas pessoas para pares consecutivos, não apenas trincas.
- Conferir as quatro células conjuntamente; preservar minutos e dias de cada semana.
- Incluir pessoas sem horário em trocas de presença, sem inventar turnos ou cobertura horária.
- Reaproveitar a busca de padrões semanais com até quatro alternativas: duas trajetórias dominicais e duas alternativas de espaçamento por trajetória.
- Antecipar REST_SPACING, dentro do orçamento Python de 12 segundos, um worker e recursos atuais. Reservar tempo somente após obter uma solução viável; contabilizar clonagem e preparação.
- Preservar cobertura por setor/dia, fechamento, picos informados, liderança responsável e equilíbrio dos fins de semana.
- Aceite: cenário sintético com troca dupla segura encontra melhora; resultado inferior é descartado; prazo esgotado não é apresentado como ótimo ou inevitabilidade.

## 3. Sábado sem folga comum

- Toda nova geração adota a versão operacional 2, proibindo OFF regular aos sábados.
- ABSENCE e HOLIDAY permanecem com suas classificações reais; não substituir afastamento por trabalho.
- Folga fixa ou bloqueada de sábado produz conflito acionável. Não desbloquear nem corrigir silenciosamente.
- Revisões antigas continuam legíveis sem reescrever seus dias. A nova regra entra na proposta regenerada.
- Aceite: nenhum OFF de sábado na nova proposta; teste de afastamento, fechamento por feriado e bloqueio conflitante; verificador independente aplica a mesma regra.
- Atenção: a restrição nova pode tornar uma referência anterior inválida. Não afirmar preservação integral da cobertura anterior se ela depender de uma escala incompatível; demonstrar os efeitos e não salvar uma regressão silenciosa.

## 4. Importação e jornadas reduzidas

- Excluir da geração colaboradores com jornada principal importada válida inferior a seis horas, incluindo 05:50 e 04:00. Preservar cadastro, arquivo original, afastamentos e registros protegidos; não ampliar essas jornadas.
- Não aplicar essa exclusão a horários zerados/ausentes classificados como presença sem horário.
- Um horário de 8h de segunda a sexta e 4h no sábado é uma referência semanal de 44h; o sábado curto não invalida a jornada principal de 8h nem torna a pessoa automaticamente excluída.
- Diferenciar referência semanal inferida dos horários e carga contratual individual: o arquivo não comprova o contrato.
- Conferir o CSV real das filiais 01 e 10, inclusive cargos de confiança e referências zeradas. Não inferir dispensa legal pelo cargo.
- Investigar a causa concreta do erro de minutos semanais e corrigir sua origem; não remover validações para aceitar uma grade errada.
- Aceite: importação e preparação dos casos 05:50, 04:00, 8h+sábado4h, zerados e incompletos concordam; original permanece preservado.

## 5. Modos de geração e menus relevantes

- Folgas e horários: distribui ambos, com proteção de cobertura.
- Apenas folgas: mantém as referências de horários e apresenta controles de distribuição.
- Apenas horários com grade: mantém dias de trabalho, folgas, afastamentos e bloqueios; ajusta somente horários permitidos. Conflitos com regras novas precisam ser explicados.
- Apenas horários sem grade: gera referências exportáveis, sem inventar WORK/OFF ou simular presença. Não declarar uma escala completa validada nem permitir sua publicação como grade completa.
- Exibir formulários e opções pertinentes ao modo. Manter acesso de consulta a dados existentes, sem painéis iniciais irrelevantes.
- Padrão de exportação: rest, hours ou both conforme o modo; referências sem grade não produzem relatório de folgas fictício.
- Aceite: três fluxos exercitados, inclusive sem grade e troca de modo; PDF/XLSX contêm referências reais, sem presença artificial.

## 6. Entrada e saída automáticas

- Padrão: comparar alternativas que preservam entrada ou saída, respeitando os intervalos.
- O Solver escolhe entre alternativas permitidas quando houver distribuição e dados de cobertura.
- Referências já compatíveis e dias bloqueados permanecem preservados. Opção manual explícita não deve ser sobrescrita silenciosamente.
- No modo de referências sem grade, não declarar que existe uma seleção ótima de cobertura: não há distribuição diária para comprovar isso.
- Aceite: alternativas de entrada/saída disponíveis quando houver adaptação; nenhuma ampliação de jornada curta; todos os horários respeitam fechamento e limites operacionais.

## 7. Desfalques de seis ou mais pessoas na filial 06 e precisão da mão de obra

- Ler a revisão atual sem alterá-la e identificar setor, datas/faixas, mínimo utilizado, pessoas com horário e motivo de cada diferença.
- Conferir se a origem é mínimo manual, estimativa automática, equipe afastada/excluída, falta de horários ou referência desatualizada.
- Deduplicar referências da mesma função; somar faltas entre funções distintas e comparar com a falta geral, sem somar picos de horários ou dias diferentes.
- Verificar coerência entre capacidade semanal e cobertura por faixa. Horas nominais não equivalem a presença garantida.
- Não reduzir estimativas apenas para melhorar o indicador nem chamar estimativa de necessidade de contratação.
- Aprimorar o cálculo por faixa usando jornadas, turnos, intervalos e dias efetivamente trabalhados, com a mesma regra no sistema, PDF e XLSX.
- Segmentar nas mudanças reais de presença e de demanda; contar cada pessoa uma vez e diferenciar presença simultânea de contribuição parcial em pessoa-minutos.
- Separar capacidade semanal nominal, disponibilidade efetiva, horas de referência e proposta, pico de falta e equivalente de horas em pessoas. Não apresentar essas medidas como se fossem o mesmo número.
- Manter alvos confirmados e a base da estimativa independentes do candidato gerado. Sem demanda real, explicitar a natureza estimada; não presumir movimento ou substituição entre funções.
- Aceite: exemplos concretos são recalculados independentemente; erro comprovado recebe regressão; limitação ou falta de demanda real fica identificada, sem falsa certeza.

## 8. Gates e entrega

1. Concluir interfaces e regras das frentes 1–7 e congelar o conjunto para revisão.
2. Executar regressões afetadas; revisar o diff completo e resolver achados concretos.
3. Executar qualidade integrada uma vez após estabilizar os novos requisitos. Não repetir suites aprovadas sem motivo; falha ou alteração posterior exige apenas os checks realmente afetados.
4. Validar Compose com acesso aos arquivos protegidos; commit e identificação da revisão; build final e auditoria das imagens.
5. Implantar app, worker e Solver na mesma revisão e conferir saúde e compatibilidade.
6. Executar regressões Python no runtime efetivamente atualizado; smoke autenticado, três modos e PDF/XLSX diretamente no servidor.
7. Recalcular somente duas grades de teste, 06 e 11, com comparação independente e controle de revisão. Para 01/10, validar importação/referências sem sobrescrever grades adicionais sem necessidade ou nova instrução.
8. Salvar apenas propostas aceitas como rascunho; não sobrescrever edições concorrentes nem publicar automaticamente.
9. Fazer push e confirmar main/servidor alinhados e worktree limpo. Preservar recuperação de código e histórico das grades.
10. Entregar resultados, evidências, diferenças de contagem e limitações. Encerrar somente temporários e processos próprios.

## 9. Matriz de interface, regras e efeitos

Uma seleção deve orientar o cenário inteiro. Campos ocultos não podem continuar alterando indevidamente o resultado. Os valores existentes permanecem preservados para consulta e para eventual retorno ao modo anterior.

| Seleção | O que gera ou preserva | Controles pertinentes | Resultado permitido |
|---|---|---|---|
| Apenas folgas | Distribui dias; mantém os horários de referência | Jornada semanal de referência, equipe, ausências, fechamento, folgas variáveis/fixas e movimento opcional | Grade de folgas; horários originais identificados, sem adaptação automática |
| Apenas horários, sem grade | Prepara referências de horários, sem criar dias trabalhados ou folgas | Jornada semanal, fechamento, ajuste automático e exceções individuais pertinentes | Prévia de horários e exportação de horários; sem publicação de uma grade completa ou cobertura diária fictícia |
| Apenas horários, com grade | Preserva datas e tipos dos dias; modifica somente horários permitidos | Os mesmos controles de horários; folgas e bloqueios ficam em consulta | Horários vinculados aos dias existentes; conflito com a grade exige orientação explícita |
| Folgas e horários | Distribui os dias e escolhe horários entre alternativas válidas | Jornada semanal, distribuição, fechamento, movimento e exceções opcionais | Grade completa, horários e desfalques coerentes com a proposta |

| Jornada escolhida | Referência uniforme em cinco dias | Opções e validações dependentes |
|---|---|---|
| 40h | 8h diárias de trabalho | Não mostrar nem aplicar a alternativa mista exclusiva de 42h |
| 42h | 8h24 diárias de trabalho | Alternativa 3 × 8h + 2 × 9h somente se ativada; nos dias de 9h, intervalo de 3h conforme a regra já configurada |
| 44h | 8h48 diárias de trabalho, quando operacionalmente admissíveis | Não reduzir silenciosamente para 42h/40h; explicar conflito de fechamento ou limites sem inventar autorização |

Intervalos não computados não integram essas durações. Uma referência importada de 8h de segunda a sexta mais 4h no sábado representa 44h semanais na origem, não uma jornada principal reduzida. O cálculo de origem e a distribuição proposta em cinco dias precisam permanecer distintos.

### Verificações específicas da experiência

- Criar planejamento → importar → escolher modo e jornada → gerar → revisar → exportar, sem cadastro burocrático inicial.
- Trocar modo, jornada, equipe, horários ou regras relevantes marca o resultado como desatualizado, inclusive referências sem grade.
- Em apenas horários, não exibir ações de corrigir folgas ou promessas de cobertura inexistente. Em apenas folgas, não exibir ajuste automático de entrada/saída como ação ativa.
- Erros próximos à ação, linguagem simples, explicação da causa e ação de recuperação que realmente funcione.
- Processamento real, prevenção de duplo clique e preservação dos dados em falha; sem porcentagem fictícia.
- Conferir os estados vazio, importado, desatualizado, processando, concluído, concluído com avisos e falha; conferir celular e computador.
- Aplicar UI/UX Pro Max, padrões de frontend e diretrizes de backend de forma complementar, preservando o design e a arquitetura Next.js existentes. Não adicionar bibliotecas nem camadas apenas para cumprir um modelo genérico.

## 10. Contratos existentes que não podem regredir

Estes itens integram a conferência de compatibilidade, não são uma afirmação de que todos foram novamente testados nesta etapa.

- Horários originais permanecem disponíveis para comparação. Quando origem e jornada escolhida são compatíveis, não adaptar todos os horários apenas para esconder desfalques.
- Quatro horários zerados continuam apresentados como ENC, sem cobertura horária inventada. Períodos incompletos recebem orientação específica; `07:00–11:00 / 00:00–00:00` permanece válido.
- Aprendizes e exclusões explícitas não voltam à geração por uma inferência de cargo. Gerentes e encarregados não recebem dispensa legal presumida ou substituição automática entre setores.
- Afastamentos do FPHI105, férias, dias bloqueados, decisões manuais e revisões concorrentes permanecem protegidos. Reimportação não exclui quem não consta do arquivo nem perde identificadores.
- Fechamento padrão às 20h, exceto filial 18 às 22h, continua configurável. Nenhuma alternativa proposta ultrapassa o limite aplicável.
- Calendário municipal de Icaraíma para a filial 02 e Umuarama para as demais; conservar a precedência dominical já solicitada e os dias de loja efetivamente fechada. Conferir conflitos com sábado sem folga, sem transformar fechamento em OFF comum.
- Jornada mista de 42h continua opcional, desativada por padrão. Preservar a opção operacional de bloco de até 4h30 e seus limites, sem confundi-la com intervalo entre blocos.
- CCT e documentos permanecem referências informativas, sem bloquear uso interno por ausência documental. Limites operacionais de jornada, intervalo, descanso e fechamento permanecem protegidos.
- Demanda estimada permanece identificada como estimativa. Capacidade nominal, disponibilidade, pessoas presentes, cobertura por horário e liderança sem horário não são números intercambiáveis.
- Não presumir maior movimento no fim de semana. Dados de movimento são opcionais; prioridades informadas e liderança responsável não podem ser ignoradas na otimização.

## 11. PDF e XLSX: auditoria funcional e visual

- Prioridade especial ao XLSX: abertura compacta, zoom útil, cabeçalhos e identificação fixos quando necessário, filtros seguros e dimensões adequadas, sem menus ou instruções grandes ocupando a tela.
- Contagens e durações somáveis devem usar valores numéricos e formatos apropriados; preservar matrículas como identificadores e zeros à esquerda. Distinguir horas acumuladas de relógios de entrada/saída.
- Inspecionar e renderizar amostras reais com os recursos específicos de planilhas e PDF já disponíveis, preservando o gerador do projeto. Instalações adicionais estão autorizadas somente quando houver uma lacuna concreta que as justifique.
- Ordenar setores A–Z; dentro do setor, horários crescentes e nomes A–Z, preservando agrupamento legível.
- Desfalques somente em horários ou completo, nunca duplicados no relatório apenas de folgas. Agrupar por setor; não espalhar cargos nem somar picos incompatíveis.
- Preservar a opção de cada setor começar em página própria. Setor extenso pode exigir continuação: não diminuir texto até ficar ilegível apenas para caber em uma página.
- Manter ENC/FE corretos, cores discretas e contrastantes, grades legíveis, margens, quebras e cabeçalhos sem sobreposição. XLSX com largura, zoom e impressão adequados.
- Remover explicações excessivas já recusadas; manter somente avisos necessários para interpretar o resultado.
- Em referências sem grade, remover totais e desfalques derivados de presença inexistente. Identificar o arquivo como referências de horários, não como escala diária concluída.
- Conferir as variantes reais da jornada mista, incluindo os dias de 9h com intervalo de 3h, quando ativada e houver uma grade.
- Aceite: verificar conteúdo e apresentação dos dois formatos nos três modos, usando combinações representativas e sem multiplicar exportações idênticas.

## 12. Pendências e checkpoints de execução

| ID | Trabalho restante ou checkpoint | Condição para concluir |
|---|---|---|
| P01 | Fechar integração de sábado e apenas horários no Python | Código efetivamente usado em produção, verificador alinhado e regressões pertinentes aprovadas |
| P02 | Finalizar apenas horários no serviço e nos relatórios | Sem dias fictícios; proteção dos dias existentes; exportação funcional 2xx; sem desfalques artificiais |
| P03 | Consolidar interface contextual | Matriz acima coerente; resultado desatualizado após mudança; nenhuma opção escondida influenciando indevidamente o cálculo |
| P04 | Analisar o CSV real das filiais 01/10 | Reproduzir a causa concreta; corrigir sem inventar turnos ou excluir pessoas por título de cargo |
| P05 | Aprimorar desfalques por jornada/turno/escala e conferir a revisão atual da filial 06 | Somatórios por faixa coerentes, sem dupla contagem; separar pico, horas, estimativa e capacidade; UI/PDF/XLSX concordantes |
| P06 | Rever a integração completa e os contratos existentes | Diff revisado; regressões afetadas aprovadas; falhas preexistentes separadas das novas |
| P07 | Qualidade, build e implantação única | Qualidade aprovada, Compose válido com arquivos protegidos e app/worker/Solver compatíveis |
| P08 | Inspeção de somente duas grades | 06 e 11 com revisão protegida, métricas antes/depois, avaliação por setor/turno; salvar apenas resultado aceito |
| P09 | Fechamento Git e evidências | Commit e push autorizados; revisão do servidor e main conferidas; pendências e temporários próprios tratados |

### Registro da auditoria de base

A auditoria original partiu de `ee815cd`. A revisão atual conferida nesta consolidação é `6f006accccef32add8ea12dec557751f1dceedce`; não reiniciar nem sobrescrever correções intermediárias.

Antes da aprovação final, relacionar as evidências anteriores às frentes originais: classificador/reimportação; referências normativas centralizadas; erros e limites distintos de 4 MiB/8 MiB; diagnóstico de conflitos; liderança/movimento; instrumentação e organização do Solver; testes de produção e E2E. O que não tiver evidência identificada continua como pendência de conferência, não como trabalho automaticamente aprovado ou automaticamente necessário de refazer.

Manter inicialmente OR-Tools, um cálculo simultâneo, um worker, 1536 MiB e orçamento Python de 12 segundos. Medir preparação separadamente. Qualquer avaliação de dois núcleos deve isolar a mudança e restaurar os limites temporários; só adotar com o ganho mínimo e sem regressões previstos no plano original. Não alegar melhora de desempenho sem medições comparáveis e identificação das revisões.

Não executar repetidamente qualidade, E2E, benchmarks ou rebuilds já aprovados sem alteração relevante. A validação final precisa cobrir o conjunto estabilizado, não apenas as partes antigas. `FEASIBLE` significa solução viável encontrada, não ótimo comprovado.

## 13. Registro de verificação na preparação do release

Este é um checkpoint histórico de 12/11/2026, antes de enviar e implantar a revisão consolidada. Resultados posteriores devem ser associados ao SHA efetivamente executado; não inferir implantação ou testes Python aprovados a partir deste registro.

| Rodada local de Escalas | Resultado observado |
|---|---|
| Primeira integração, 103 arquivos | 1.048 casos aprovados e 40 falhos; implantação bloqueada |
| Repetição após correções compartilhadas | 1.086 casos aprovados e quatro falhos; tipos, lint, Knip e módulos aprovados |
| Validação residual, sete arquivos | 89 de 89 casos aprovados, tipos e lint atuais aprovados; quatro falhas encerradas |

- Não foram desativados testes, guardas ou gates. Prisma e cobertura estática de rotas conservaram evidências aprovadas porque seus insumos não mudaram. O `quality` que cria ambiente isolado não foi executado no servidor; a confirmação integral do fluxo oficial é do CI remoto, seguida do smoke real.
- Os três modos têm contratos de backend, interface e exportação. Referências de horários sem grade não criam folgas, dias trabalhados, capacidade efetiva ou desfalques fictícios. Com grade, apenas horários preserva dias, tipos e bloqueios.
- A importação real das filiais 01/10 foi conferida nas referências de 42h e 44h. Principal de oito horas com sábado de quatro horas permanece elegível; jornadas principais excluídas não são confundidas com o sábado. A expansão de seis horas recebe intervalo válido. Originais e restrições permanecem preservados; a configuração salva que originou a reclamação não foi reproduzida exatamente.
- A análise de desfalques separa presença com horário, horas da equipe, referência nominal, pico e fontes confirmada/estimada. Dados ausentes não viram zero. Comparações exigem a mesma coorte e a mesma meta preparada; exclusões legítimas não são evidência de piora de distribuição. Não foram inventados movimento, contratação ou demanda real.
- PDF/XLSX consomem esse mesmo núcleo. O resumo final tem oito campos e um único maior desfalque com dia e faixa próprios; valores semanais e de período ficam separados. Datas/durações são nativas e matrículas continuam texto. Ordenação, variantes, ENC/FE, paginação, 6.000 demandas e duração acima de 24h possuem regressões; as amostras renderizadas ficam fora do Git.
- A investigação do CI da base `6f006ac` identificou três falhas Python de preservação da grade inicial. O patch dirigido mantém a guarda de 480 por setor, corrige uma fixture com três folgas históricas e reaproveita o padrão de descanso ao adaptar relógios, sem locks permanentes. AST/diff não equivalem à execução: o CI do novo SHA precisa confirmar os casos antes do build de produção.
- A sequência de liberação é revisão, commit/push, CI do SHA enviado, um build/implantação oficial de app/worker/Solver na mesma revisão e inspeção real. Somente as duas grades autorizadas podem ser recalculadas com CAS e comparação independente; não publicar automaticamente nem gravar regressão silenciosa.

Dados pessoais, arquivos de importação reais e evidências privadas não fazem parte das fixtures ou deste documento versionado. O relatório de entrega e os metadados de implantação registram o resultado operacional final; este checkpoint não é atualizado para simular sucesso retroativo.

## Critério de conclusão

Código escrito não é entrega concluída. Aprovação exige evidência funcional por frente e ausência de regressão nas condições protegidas. Toda pendência restante deve constar do relatório final, distinguindo defeito, conflito operacional, informação ausente e busca inconclusiva.
