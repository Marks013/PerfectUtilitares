# Timefold sob demanda e controle de recursos da OCI A1 compartilhada

> **Prioridade operacional revisada:** consultar primeiro o [roteiro de execução](ROTEIRO-EXECUCAO-ESCALAS-2026-11-25.md) e a [especificação executável](ESPECIFICACAO-EXECUTAVEL-TIMEFOLD-2026-11-25.md). A primeira comparação é OR-Tools atual × Timefold Community. SolverForge é a segunda opção condicional; CP-SAT reformulado, SCIP/HiGHS e híbridos ficam em reserva. A referência é o produto real, não o benchmark genérico.

> **Revisão normativa:** [especificação executável](./ESPECIFICACAO-EXECUTAVEL-TIMEFOLD-2026-11-25.md) e [seleção de motores](./SELECAO-COMPARATIVA-MOTORES-2026-11-25.md). READY_IDLE somente se o candidato vencedor exigir serviço residente; para o primeiro protótipo, sem fila interna (429 em ocupação), sem scale-to-zero e sem tocar no solver produtivo. Os gates A0-A4 são subtestes de G6/G7, não autorização. Cancelamento cooperativo requer prova de encerramento e política de falha.

Status: arquitetura para futura prova de conceito. Somente documentação; nao instalar controlador, acionar Docker ou alterar servicos agora.
VM informada: Oracle VM.Standard.A1.Flex, 4 OCPUs ARM64, 24 GB, Ubuntu 24.04. Outros projetos utilizam o mesmo host. Nao reservar a VM inteira para escalas.

## Decisao

Adotar dois niveis, nesta ordem:

1. Basico, obrigatorio: executar Timefold com quota cgroup de CPU/RAM, SolverManager com um calculo simultaneo, admissao sob pressao sem fila interna inicialmente. Enquanto nao esta resolvendo, o Timefold fica ocioso. E a abordagem mais simples, com tempo de resposta estavel e sem controlador privilegiado de start/stop.
2. Opcional, DESLIGADO POR PADRAO: escala-a-zero fisica somente se cold start comprovado for rapido e se a memoria residente representar um problema real. Nao desligar a JVM automaticamente apos 5-10 minutos por padrao. O modo inicial obrigatorio e READY_IDLE: JVM Quarkus pronta, nenhum solve ativo, com quota rigida e CPU de otimizacao ociosa. Se startup nao cumprir o limite, manter READY_IDLE sem permitir espera longa ao usuario.

O motor Timefold oferece SolverManager assíncrono e terminateEarly por identificador. Isso NAO sobe nem para um container Docker automaticamente. A ativacao fisica requer componente separado.

## Parecer de viabilidade/compatibilidade (fontes oficiais, 25/11/2026)

**COMPATIVEL em arquitetura; NAO homologado neste host.** Timefold 2.x suporta Java 21+ e Quarkus 3.x. Java Temurin 21 possui runtime Linux ARM64/AArch64. Quarkus SmallRye Health fornece /q/health/live, /q/health/ready e /q/health/started. Timefold SolverManager agenda solves de forma assincrona e suporta terminateEarly; parallel-solver-count=1 impede mais de uma otimizacao simultanea. A compatibilidade efetiva Timefold 2.8.0 + Quarkus 3.40.1.2 + imagem ARM64 ainda depende de compilacao, container e testes reais da POC.

**Distincao importante:** quarkus.timefold.solver.daemon=true **NAO** suspende a JVM quando o sistema esta ocioso. Esse modo espera mudanças de fatos do mesmo problema, usado no planejamento continuo e pode manter uma tarefa ocupada. Para escalas solicitadas sob demanda, configurar daemon=false e usar SolverManager para iniciar somente uma busca quando for necessario. O servico REST permanece pronto/ocioso.

**Condicao de resposta rapida:** nenhum usuario deve aguardar varios minutos pela ativacao. O padrao sera READY_IDLE permanente enquanto o monitor confirmar memoria disponivel. O controlador de recursos calcula medias em segundo plano, nao inicia uma nova janela de observacao de 30-60 s somente apos o clique. Em recurso insuficiente, responder OCUPADO/INDISPONIVEL de forma imediata sem fila interna na primeira versao; nunca manter fila por 15 minutos.

Metas para POC, **nao promessas de latencia medida**:
- READY_IDLE: resposta de admissao interna p95 <= 1 s; inicio efetivo da busca p95 <= 2 s depois de receber pedido admitido, sem incluir os 12 s de busca de otimizacao.
- JVM JVM-mode cold start (se habilitar escala-a-zero): readiness p95 <= 5 s e timeout total de ativacao <= 10 s no AArch64 sob limites aprovados, medidos sem competicao indevida com outros projetos. Se falhar, desabilitar escala-a-zero e conservar READY_IDLE.
- O contrato de transporte atual tem aproximadamente 20 s na chamada normal do Node; nunca somar 10 s de partida, 12 s de busca e outros custos dentro dessa chamada esperando que nao haja timeout. Qualquer escala-a-zero so cabe mediante fluxo assincrono e estados versionados/validados de preparacao ou mecanismo que inicie o Java antes do prazo de busca.
- CPU de otimizacao durante READY_IDLE deve ser nula, mas a JVM ainda consome RAM e alguma CPU de housekeeping. Medir CPU/RSS/GC e impacto do Quarkus no host em repouso; nao prometer uso de CPU do processo igual a zero.
- Limitar move-thread-count=NONE e parallel-solver-count=1, e ter uma trava de admissao no servico. O SolverManager pode manter fila interna, portanto impedir fila ilimitada mesmo com paralelo em 1.

**Quarkus em JVM-mode** e a primeira escolha: startup costuma ser rapido nas cargas de referencia do Quarkus, mas nenhum benchmark generico comprova desempenho de Timefold na VM A1 compartilhada. Native image pode acelerar startup e economizar RAM, porem a ausencia de JIT pode piorar a qualidade da otimizacao em 12 s; so adotar se os benchmarks da POC provarem a vantagem.

Fontes oficiais: https://docs.timefold.ai/timefold-solver/latest/frequently-asked-questions ; https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/library/quarkus ; https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/library/library-integration ; https://quarkus.io/guides/smallrye-health/ ; https://quarkus.io/guides/building-native-image-guide/ ; https://adoptium.net/supported-platforms/ .

## Capacidade real e envelope inicial

As quotas de CPU atualmente declaradas no Compose do PerfectUtilitares sao aproximadamente: DB 1.0, app 1.5, PDF 2.0, Python Solver 1.0, total potencial de 5.5 CPUs de quota sobre 4 OCPUs fisicos, antes de considerar os demais projetos. Quotas sao tetos de consumo, nao reserva real. O consumo real nao foi medido nesta conversa.

Proposta de ensaio isolado, nao de producao:
- Timefold com uma otimizacao por vez, sem parallelismo de solves.
- Testar primeiramente quota entre 0.50 e 0.75 OCPU, RAM limitada a 1.0 a 1.5 GiB, heap explicitamente menor que RAM cgroup (por exemplo 768 MiB se o cgroup permitir 1.5 GiB). Sao hipoteses para benchmarking; podem ser insuficientes para 250 pessoas por 42 dias.
- Nao iniciar solucao se carga agregada, memoria disponivel ou PSI de memoria/CPU indicar pressao relevante. Observar por 30 a 60 segundos, nao por um instante nem somente pelo loadavg.
- Manter margem documentada para kernel, banco, Next.js, PDFs e todos os outros projetos. Nenhum ajuste de quotas de servicos alheios.
- Nao usar swap como substituto de RAM para otimizar; testar casos OOM/cgroup e picos JIT/GC.
- Se a quota limitada nao entregar cobertura e desempenho aceitaveis, NAO aumentar automaticamente a quota e NAO implantar. Reavaliar modelo, janela de calculo ou host.

## Estados internos do controlador de ativacao

OFF -> CHECKING -> STARTING -> READY -> SOLVING -> COOLDOWN -> STOPPING -> OFF.

De CHECKING ir a BUSY/WAITING_CAPACITY quando host sobrecarregado; no maximo uma tarefa ativa, sem pendencia interna no ensaio. De STARTING e SOLVING poder ir a ERROR/CANCELLED. Nunca confundir resposta HTTP cancelada com solver realmente encerrado.

1. Usuario aciona a geracao pelo fluxo autenticado atual; o Next.js verifica tenant, permissao, revisao, aprovacao da politica e idempotencia.
2. O controlador recebe apenas pedido interno autorizado e IDs opacos, checa a pressao do host e a quota. Se nao houver capacidade, nao inicia Java; devolve ocupacao ou indisponibilidade sem espera interna na primeira versao.
3. Se OFF e capacidade suficiente, o controlador inicia apenas o servico Java. Aguarda readiness. Opcionalmente aquece JIT com problema sintetico nao sensivel.
4. Timefold executa com limite de tempo e de recursos; o retorno e validado independentemente no TypeScript. Um resultado incompleto, nao verificado ou pior em cobertura nunca substitui a grade.
5. Cancelamento antes da partida evita spawn; durante SOLVING usa terminateEarly e confirma estado terminal antes de liberar vaga.
6. NO PADRAO READY_IDLE, nao suspender o processo: apenas deixar SolverManager sem tarefa ativa. SO NO MODO OPCIONAL scale-to-zero, apos TTL comprovado, desligar quando nao houver jobs, respostas ou cancelamentos pendentes. Evitar ciclos de liga/desliga.

## Seguranca da ativacao

NAO montar /var/run/docker.sock no container Next.js nem no container Solver. Acesso ao Docker socket equivale a uma superficie de administracao elevada do host.

Para escala-a-zero, usar controlador host com operacoes estritamente limitadas a iniciar/parar a unidade Timefold especifica, interface Unix socket autenticada e permissoes minimas. O aplicativo nao escolhe comandos shell, servicos, imagens nem caminhos. Auditar permissao de usuario/grupo. Alternativamente usar supervisor especifico com permissao delegada; nunca aceitar requisicoes pela internet.

O recurso de systemd socket activation somente funciona se o processo destino aceitar os descritores de socket fornecidos pelo systemd ou houver proxy adaptador. Quarkus REST no Docker nao passa a aceitar systemd socket automaticamente.

Revisar no spike o comportamento de Docker restart: unless-stopped, Compose profiles, reboot e falha do daemon; um restart nao pode executar trabalhos antigos nem iniciar automaticamente uma geracao cancelada.

## Interface, estado e latencia

O transporte atual trabalha com /solve e /cancel, com timeout de HTTP privado por volta de 20s no fluxo normal, enquanto o backend ja possui operacoes de geracao assincronas. Nao incorporar espera de fila e cold start dentro do prazo de busca de 12s. Verificar se o START_GENERATION permite informar preparacao e disponibilidade sem alterar indevidamente o contrato. Se forem necessarios estados novos, evoluir os DTOs e testes do API de forma versionada.

Sem fila interna na primeira versao; fila limitada externa e timeout so em revisao posterior do contrato. Em host ocupado: preservar o rascunho e oferecer tentar novamente, sem aumentar CPU para passar pelo prazo. Nao usar background tasks sem estado persistido/contrato e sem idempotencia.

Quando a pressao aumenta durante uma busca, utilizar cancelamento cooperativo seguro e a ultima proposta comprovadamente viavel, se existir; caso contrario, reter a grade anterior. Uma falha OOM nao pode causar nova tentativa automatica infinita.

## Testes de admissao e de nao interferencia

- Medir consumo OFF, STARTING, READY e SOLVING; tempo de cold start, RSS/cgroup, heap, metaspace, GC, CPU, PSI e consumo do controlador.
- Comparar casos do roteiro, inclusive 10/1, 50/4, 115/6, maior filial sintética de dezembro/31 dias, HOURS_ONLY, recuperação especial e 250/6 de stress, com cinco repeticoes exploratorias por variacao e amostra final conforme especificacao normativa e limite identico. Nao piorar cobertura por cargo/faixa, folgas obrigatorias nem estado protegido.
- Testar host livre e host ocupado artificialmente EM STAGING; validar que outros servicos continuam saudaveis e respondem sem degradacao superior ao SLO aprovado.
- Testar fila cheia, usuario sem autorizacao, cancelamento antes/depois de ativacao, erro de readiness, cold start demorado, reboot, encerramento durante solve e erro de memoria.
- Nao incluir dados de colaboradores no controlador, logs ou metricas. Apenas contadores de fila, CPU/RAM agregados, identificador opaco da operacao e erros saneados.
- Experimento de JVM pronta versus scale-to-zero fisico: escolher escala-a-zero somente se a economia medida de RAM for maior que os riscos de startup e os impactos no tempo de resposta.

## Gates

A0: confirmar consumo real do host compartilhado e inventario de concorrencia de outros projetos, sem ler dados privados deles.
A1: POC Timefold em container com cgroup limitado, pronto e ocioso, testando SolverManager e cancelamento.
A2: controlador host isolado e testes de seguranca; manter desabilitado por padrao.
A3: integrar estados com operacoes assincronas em ambiente de teste, validar tempo e rollback.
A4: aprovar recursos e ativacao definitiva com evidencia de nao interferencia. Se algum gate falhar, nao implantar e preservar OR-Tools.

Fontes: Timefold SolverManager https://docs.timefold.ai/timefold-solver/latest/using-timefold-solver/running-the-solver ; Docker quotas https://docs.docker.com/engine/containers/resource_constraints/ ; systemd socket activation https://www.freedesktop.org/software/systemd/man/latest/systemd.socket ; Quarkus JVM/native https://quarkus.io/version/3.40/guides/building-native-image/ .
