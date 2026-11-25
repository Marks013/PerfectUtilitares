# Timefold sob demanda e controle de recursos da OCI A1 compartilhada

Status: arquitetura para futura prova de conceito. Somente documentação; nao instalar controlador, acionar Docker ou alterar servicos agora.
VM informada: Oracle VM.Standard.A1.Flex, 4 OCPUs ARM64, 24 GB, Ubuntu 24.04. Outros projetos utilizam o mesmo host. Nao reservar a VM inteira para escalas.

## Decisao

Adotar dois niveis, nesta ordem:

1. Basico, obrigatorio: executar Timefold com quota cgroup de CPU/RAM, SolverManager com um calculo simultaneo, admissao sob pressao e fila curta. Enquanto nao esta resolvendo, o Timefold fica ocioso. E a abordagem mais simples, com tempo de resposta estavel e sem controlador privilegiado de start/stop.
2. Opcional apos medicao: ativacao fisica automatica. Container Java fica desligado quando sem trabalho, e um controlador de host de privilegio minimo o inicia para resolver pedidos, aguarda /health, e o para apos 5 a 10 minutos de inatividade, apenas se nao houver trabalhos ativos ou pendentes. Nao presumir que ganhos de RAM compensam o cold start e o custo operacional.

O motor Timefold oferece SolverManager assíncrono e terminateEarly por identificador. Isso NAO sobe nem para um container Docker automaticamente. A ativacao fisica requer componente separado.

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

De CHECKING ir a BUSY/WAITING_CAPACITY quando host sobrecarregado; no maximo uma tarefa ativa e uma pendente por instancia no ensaio. De STARTING e SOLVING poder ir a ERROR/CANCELLED. Nunca confundir resposta HTTP cancelada com solver realmente encerrado.

1. Usuario aciona a geracao pelo fluxo autenticado atual; o Next.js verifica tenant, permissao, revisao, aprovacao da politica e idempotencia.
2. O controlador recebe apenas pedido interno autorizado e IDs opacos, checa a pressao do host e a quota. Se nao houver capacidade, nao inicia Java; devolve ocupacao ou espera limitada.
3. Se OFF e capacidade suficiente, o controlador inicia apenas o servico Java. Aguarda readiness. Opcionalmente aquece JIT com problema sintetico nao sensivel.
4. Timefold executa com limite de tempo e de recursos; o retorno e validado independentemente no TypeScript. Um resultado incompleto, nao verificado ou pior em cobertura nunca substitui a grade.
5. Cancelamento antes da partida evita spawn; durante SOLVING usa terminateEarly e confirma estado terminal antes de liberar vaga.
6. Depois de ficar ocioso pelo TTL escolhido, suspende somente se nao houver jobs, respostas ou cancelamentos pendentes. Evitar ciclos de liga/desliga e colocar cooldown minimo.

## Seguranca da ativacao

NAO montar /var/run/docker.sock no container Next.js nem no container Solver. Acesso ao Docker socket equivale a uma superficie de administracao elevada do host.

Para escala-a-zero, usar controlador host com operacoes estritamente limitadas a iniciar/parar a unidade Timefold especifica, interface Unix socket autenticada e permissoes minimas. O aplicativo nao escolhe comandos shell, servicos, imagens nem caminhos. Auditar permissao de usuario/grupo. Alternativamente usar supervisor especifico com permissao delegada; nunca aceitar requisicoes pela internet.

O recurso de systemd socket activation somente funciona se o processo destino aceitar os descritores de socket fornecidos pelo systemd ou houver proxy adaptador. Quarkus REST no Docker nao passa a aceitar systemd socket automaticamente.

Revisar no spike o comportamento de Docker restart: unless-stopped, Compose profiles, reboot e falha do daemon; um restart nao pode executar trabalhos antigos nem iniciar automaticamente uma geracao cancelada.

## Interface, estado e latencia

O transporte atual trabalha com /solve e /cancel, com timeout de HTTP privado por volta de 20s no fluxo normal, enquanto o backend ja possui operacoes de geracao assincronas. Nao incorporar espera de fila e cold start dentro do prazo de busca de 12s. Verificar se o START_GENERATION permite informar preparacao e disponibilidade sem alterar indevidamente o contrato. Se forem necessarios estados novos, evoluir os DTOs e testes do API de forma versionada.

Fila sempre limitada e com tempo maximo de espera. Em host ocupado: preservar o rascunho e oferecer tentar novamente, sem aumentar CPU para passar pelo prazo. Nao usar background tasks sem estado persistido/contrato e sem idempotencia.

Quando a pressao aumenta durante uma busca, utilizar cancelamento cooperativo seguro e a ultima proposta comprovadamente viavel, se existir; caso contrario, reter a grade anterior. Uma falha OOM nao pode causar nova tentativa automatica infinita.

## Testes de admissao e de nao interferencia

- Medir consumo OFF, STARTING, READY e SOLVING; tempo de cold start, RSS/cgroup, heap, metaspace, GC, CPU, PSI e consumo do controlador.
- Comparar 10/1, 50/4, 115/6, 250/6 dias/equipe, com ao menos cinco repeticoes por variacao e limite identico. Nao piorar cobertura por cargo/faixa, folgas obrigatorias nem estado protegido.
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
