# Fechamento parcial das ressalvas — 30/10/2026

Estado: etapa de segurança, cancelamento e ordenação validada para publicação. Capacidade operacional recuperada e retestes concluídos. A troca do algoritmo permanece reprovada e isolada; não é uma declaração de conclusão integral do plano.

## O que foi implementado

- Segredo aleatório exclusivo app/solver, em arquivo fora do Git, permissões 0600 e UID1001; não reutiliza nem altera senha administrativa ou cookies operacionais. Autorização interna verificada antes de consumir corpo e vaga. Erros e logs não incluem a credencial.
- Registro mínimo de operação por empresa, sessão, planejamento e revisão, sem CSV ou proposta pessoal no banco de controle. Migração aditiva com FK composta e índice único parcial: apenas uma operação ativa por sessão.
- Identidade de conta estável em claim JWT durante renovação. JWT legado ganha identidade derivada do jti assinado; sessões operacionais continuam vinculadas ao próprio registro. Uma sessão não consulta nem cancela a operação de outra.
- Processo filho por cálculo, prazo total de processamento, cancelamento cooperativo/stop_search e encerramento limitado somente ao filho da operação. A vaga só é liberada depois da saída confirmada. Ausência de resultado não é tratada como INFEASIBLE.
- Interface registra a operação antes de calcular, usa transporte independente para cancelar, mantém Cancelando até confirmação e rejeita resultado tardio. Navegação envia cancelamento keepalive. Grade salva e revisão não mudam pela geração/cancelamento.
- Setores do campo de desfalques e seletores de cobertura/gráfico ordenados por collator português, incluindo acentos e números.
- Transporte de resposta limitado a 8 MiB, compatível com 10500 atribuições/IDs Unicode de 100 caracteres; erro de leitura/aborto não vira sucesso. Segredo abre com O_NOFOLLOW/O_NONBLOCK, impedindo bloqueio por FIFO.

## Algoritmo: candidata recusada, não escondida

Foram separadas fases dominicais/sábados e ampliadas trocas entre semanas. Foram medidos exatamente 140 resultados de aceitação: dez repetições por versão e filial, com 1 CPU/1536 MB, nas sete filiais. A fonte de cada variante foi congelada em memória e registrada por hash. O baseline 2b1ea26 usa seus próprios solver/hints/optimization, sem misturar otimização atual.

Todas as 140 respostas passaram nas invariantes independentes e preservaram ausências. Entretanto, o gate de qualidade operacional reprovou:

| Filial | Descoberto mediano anterior/candidata | Domingos anterior/candidata |
| --- | ---: | ---: |
| 02 | 138042 /119570 |1666 /6667 |
| 06 | 173469 /174391 |20000 /25000 |
| 07 | 212602 /212602 |12666 /12666 |
| 08 | 114939 /113821 |1000 /5001 |
| 11 | 138312 /138568 |20000 /20000 |
| 16 | 77186 /71762 |0 /3334 |
| 18 | 156268 /160512 |6666 /11666 |

Uma única média favorável ou o fato de uma fase rodar não bastam para aprovar. Calibrações posteriores de uma repetição demonstraram melhora dominical na07 e trocas entre cobertura e domingos em outras filiais; não são o novo conjunto de aceitação.

A implementação experimental permanece em candidate_solver.py/candidate_optimization.py/weekend_balance.py, com testes próprios e entrada de benchmark, mas NÃO é copiada pela imagem de produção nem importada pelo worker. A política ativa continua sendo a de 2b1ea26; solver.py/optimization.py receberam apenas hooks de cancelamento. Não há mudança silenciosa de prioridades para fazer o gate passar.

Pendência: decidir a relação aceitável entre cobertura estimada e equilíbrio de domingos ou demonstrar melhora de ambos em novo conjunto completo. Não há promessa de ótimo global em 12s. Preservar a candidata e seus resultados não significa publicá-la.

Evidência agregada: benchmark-ressalvas-reprovado-2026-10-30.json. Não contém nomes, matrículas, CID, CSV ou atribuições pessoais.

## Validação realizada

- Quality invocado uma vez: Prisma, tipos, lint, 20 testes operacionais, 291 arquivos Vitest/2169 testes aprovados/3 ignorados, dead-code, modularidade e 73/73 rotas funcionais 2xx passaram. Cobertura observada: 65,33% linhas, 63,37% statements, 59,42% funções e 56,20% branches; gates não foram reduzidos.
- A rodada geral de navegador teve 44 aprovados, 22 falhos e 5 ignorados. Falhas incluem compartilhamento indevido de cota entre testes (429/login), e proteção de capacidade do servidor (507). Não se declara essa rodada aprovada.
- Fixture E2E agora usa identidade de rede distinta por cenário somente em ambiente isolado local; limites de produção e verificação de rate limit permanecem intactos. Timeout de espera de geração acompanha o prazo real de 18 s mais transporte, sem porcentagem fictícia.
- Após os ajustes, 11 E2E dedicados passaram em 4,3 min no bundle de produção: FPRE136/FPHI105 originais, férias, geração/persistência/exportação, cancelamento/geração seguinte, autorização cruzada entre sessões, recuperação, responsividade e ordenação. Dados privados foram fornecidos por stdin SSH/memfd, sem persistir arquivos ou traces pessoais.
- Suíte Python final: 123 testes passaram em 53,998 s, incluindo serviço HTTP real, startup por arquivo 0600, ausência/segredo fraco/symlink/FIFO, limitação de threads, timeout, replay, cancelamento e próxima execução. Testes executados read-only com tmpfs somente para o temporário dos testes; CI recebeu o mesmo tmpfs.
- Build de produção passou. Compose protegido validado com config --quiet e segredo provisionado, sem revelar valores.

## Bloqueio operacional encontrado

O disco foi medido em 83% de 184 GB, com 33 GB livres. A aplicação bloqueia tarefas pesadas a partir de 80%; por isso retornou507 corretamente. Há 9,713 GB de build cache Docker recuperável na observação. Cache compartilhado não foi removido sem autorização. Não foi alterado o limite de 80% nem a reserva de 30 GiB para ocultar o problema. Contêineres de produção permaneciam healthy.

Após autorização explícita, o build cache não utilizado foi removido pelo builder default. Docker reportou 61,09 GB de cache lógico descartado; o disco passou de 83%/33 GB livres para 76%/45 GB livres, aproximadamente 12 GB físicos recuperados. A contagem de imagens, contêineres e volumes foi preservada; nenhuma imagem de recuperação ou banco foi removido. O cache será recriado pelos próximos builds.

## Fonte única e Git

O usuário confirmou: o projeto em /home/ubuntu/PerfectUtilitares é a fonte correta e única; main deve ser seu espelho. A inspeção remota não encontrou commits novos em origin/main ausentes do servidor. Havia 11 commits do servidor pendentes de push.

As branches locais de Reajuste já são ancestrais de main. A única referência antiga não ancestral, fix/unimed-automatic-operator-name, possui patch equivalente já integrado (git cherry retornou “-”). Não há código exclusivo dessa branch a importar. A consolidação pode registrar sua ancestralidade preservando a árvore atual do servidor, sem substituir arquivos ou forçar histórico.

Antes de remover referências históricas remotas: preservar tags de arquivo para cada ponta e conferir cobertura por main/equivalência. Nenhum segredo, fixture privada, temporário ou alteração do checkout local do Windows deve entrar no commit. O checkout local não é fonte de publicação.

## Recuperação e fechamento ainda a registrar

App e solver devem ser implantados como par compatível com autenticação obrigatória. Não usar bypass sem segredo. Preservar imagens anteriores e banco; migração é aditiva. Registrar depois da publicação: commit de código, saúde, smoke autenticado, controle de cancelamento em produção, commit documental e igualdade entre HEAD e origin/main. Enquanto isso não ocorrer, este documento não afirma que houve implantação/push.


## Reteste final antes da publicação

A etapa geral foi retomada no bundle de produção: 66 aprovados, cinco condicionais ignorados e um teste de debounce falho por temporização da automação. Esse teste foi tornado determinístico com o relógio de navegador do Playwright, mantendo servidor, validação e persistência reais. O reteste isolado passou. Resultado agregado: 67 cenários aprovados, cinco condicionais ignorados e nenhuma falha pendente da rodada geral.

Também passaram os 11 E2E dedicados com os CSV privados, 123 testes Python, 54 testes focados finais de autenticação/API/cancelamento, TypeScript, dead-code, modularidade (381 módulos) e 73/73 rotas funcionais. O build não foi repetido por ajustes de teste/documentação. A política de capacidade permanece 80%/30 GiB.

Imagens anteriores preservadas em web-{app,pdf-worker,migrate,escalas-solver}:rollback-control-20261030. O smoke posterior à publicação usará somente sessão e planejamento sintéticos temporários, com remoção dos próprios registros. Não haverá aplicação automática em grade existente.
