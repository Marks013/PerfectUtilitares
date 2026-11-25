# Java/Timefold: bibliotecas, complementos, compatibilidade e margem operacional

Data da verificação pública: 25/11/2026. Estado: recomendação para protótipo, SEM instalação em produção.
Versão de referência do repositório: main f78c691edbeaf16283f534bcacd8db1b4b7d5e66.

## Escolha conservadora para o primeiro serviço

- Timefold Solver Community 2.8.0, de 03/11/2026. Java 21+. Apache-2.0. Confirmar checksums de Maven Central e gerar SBOM antes de executar no CI.
- Quarkus 3.40.1.2 LTS, de 09/11/2026 (último micro LTS verificado, com correções de segurança). Evitar Quarkus 4 beta/RC nesta migração, apesar de a página do registro destacar betas futuras.
- JVM Java 21 LTS em container runtime minimalista, com JIT C2 ativo. Construção com Maven Wrapper 3.9.x e Maven Enforcer para JDK 21; versões fixas sem SNAPSHOT. Java 25 pode ser avaliado em ensaio separado sem mudar a base de compatibilidade.
- Duas BOMs compatíveis: io.quarkus.platform:quarkus-bom na versão 3.40.1.2; ai.timefold.solver:timefold-solver-bom na versão 2.8.0. Gerar dependency:tree, assegurar que extensão Quarkus e módulos Timefold usem a mesma versão, e não misturar Quarkus 4/Jackson 3 com o módulo Quarkus 3/Jackson 2.
- Não adicionar frameworks e bibliotecas só por reputação. Começar com configuração Timefold padrão, registrar desempenho; ajustar estratégias somente mediante teste comparativo.

## Dependências Maven a considerar

| Camada | Coordenada | Política | Razão |
| --- | --- | --- | --- |
| Solver integrado | ai.timefold.solver:timefold-solver-quarkus | OBRIGATÓRIO | Extensão oficial com SolverManager, SolverFactory, SolutionManager e ConstraintVerifier injetáveis |
| HTTP JSON | io.quarkus:quarkus-rest-jackson | OBRIGATÓRIO | REST interno /health, /solve e /cancel, com DTOs controlados e Jackson 2 |
| Validação | io.quarkus:quarkus-hibernate-validator | OBRIGATÓRIO | Bean Validation dos DTOs e limites; complementar com regra semântica própria |
| Saúde | io.quarkus:quarkus-smallrye-health | OBRIGATÓRIO | Readiness/liveness /q/health; manter /health compatível com transporte existente |
| Métricas | io.quarkus:quarkus-micrometer-registry-prometheus | RECOMENDADO com rede interna | p50/p95, fila, duração, erro, utilização de JVM sem IDs de pessoa |
| Testes de Constraint Streams | ai.timefold.solver:timefold-solver-test | APENAS TEST | ConstraintVerifier/JUnit por regra e por fronteira |
| Teste Quarkus | io.quarkus:quarkus-junit5 | APENAS TEST | Bootstrap e teste unitário/integrado |
| Teste REST | io.rest-assured:rest-assured | APENAS TEST | Auth, entrada, erro, limites, cancel e health |
| Benchmark Timefold | ai.timefold.solver:timefold-solver-benchmark | PERFIL DE BENCHMARK, sem empacotar em runtime | Estatísticas, configurações de local search, múltiplos seeds |
| Score JSON Timefold | ai.timefold.solver:timefold-solver-quarkus-jackson | CONDICIONAL | Só se a serialização da PlanningSolution/Score for comprovadamente necessária; preferir DTOs sem score bruto |
| Quarkus REST sem Jackson | io.quarkus:quarkus-rest | NÃO adicionar se já transitivo | quarkus-rest-jackson inclui o transporte necessário; evitar duplicação |
| Core Timefold | ai.timefold.solver:timefold-solver-core | NÃO adicionar se já transitivo do módulo quarkus | Evitar dependência duplicada; usar apenas se dependency:tree demonstrar falta |
| Testcontainers | org.testcontainers:testcontainers | CONDICIONAL, apenas teste | A integração externa já usa PostgreSQL descartável no CI TypeScript; o serviço Java não deve depender de DB |
| JFR | Incluso no JDK 21 | DIAGNÓSTICO, sem dependência extra | CPU, heap, GC e allocation profiling sintético |
| Native Image/GraalVM | Ferramenta JDK, sem dependência inicial | NÃO na primeira versão | Startup menor pode vir com busca mais lenta pela ausência do JIT; benchmarking antes de adotar |

As coordenadas de todas as extensões acima são oficiais; versões de módulos Quarkus são gerenciadas pela BOM Quarkus, as de Timefold pela BOM Timefold. Evitar especificar versões individuais que conflitam.

## Não instalar de início

- Spring Boot, timefold-solver-spring-boot-starter e Jackson 3: seria segunda stack HTTP e no Timefold 2.x o starter exige Spring Boot 4. Escolhemos Quarkus 3 e Jackson 2.
- timefold-solver-service-parent em Preview: gera endpoints e lifecycle próprios e **não está demonstrada** compatibilidade com Bearer, /cancel, requestId, revisão, schema e códigos privados existentes. Fazer apenas PoC comparativa, sem escolher para produção enquanto Preview.
- Hibernate ORM/JPA, Panache, JDBC/PostgreSQL no Java, Redis, Kafka, RabbitMQ: o motor é stateless, não controla a base de RH nem precisa de nova fila persistente.
- OptaPlanner e OR-Tools dentro do serviço Java, bibliotecas genéticas ou plugins CP-SAT: não duplicar o motor que está sendo substituído.
- Lombok, MapStruct e frameworks de mapping: iniciar com records DTOs Java e mapeadores pequenos e explícitos; reavaliar só se o custo manual justificar.
- Biblioteca extra de cálculo de datas: java.time já trata datas, ZoneId America/Sao_Paulo e instantes; testar DST com casos fixos. Não usar Joda-Time.
- Não instalar profiler adicional, custom move selector, Nearby Selection ou score calculators manuais na primeira versão. Na documentação oficial 2.8, Constraint Profiling, Score Analysis avançada e Nearby Selection aparecem entre recursos comerciais/Enterprise; não planejar seu uso na Community sem confirmação de disponibilidade/licença. Apenas adicionar algo após prova de ganho no benchmark sintético.
- Agentes de logs que exportem stack trace com nomes ou payloads; nunca publicar dataset ou recibos assinados.

## Configuração Timefold inicial (conceitual, não aplicar no app atual)

Propriedade quarkus.timefold.solver-manager.parallel-solver-count = 1: evita que AUTO abra mais solves do que o limite do servidor. O gate HTTP preserva a política atual de uma operação pesada, com 429/503 para excedentes e cancelamento proprietário.

Propriedade quarkus.timefold.solver.termination.spent-limit = 12s: equivalente ao orçamento normal de busca atual. Operação excepcional de pares de folga usa outra configuração privada de tempo após testes específicos, sem substituir o deadline da API por um valor novo silencioso.

EnvironmentMode em CI de regras: PHASE_ASSERT para smoke, STEP_ASSERT em testes pequenos, FULL_ASSERT/ NON_INTRUSIVE_FULL_ASSERT em jobs dedicados e curtos. Em produção usar PHASE_ASSERT ou valor comprovado por testes, nunca modos assertivos pesados sem medir.

Usar Construction Heuristic + Local Search padrão no spike, HardMediumSoftScore com long na Timefold 2.x, Constraint Streams para regras. Pinning e filtros de alternativas por data, não mecânica manual de fixação de domínios. Não ligar automaticamente Nearby Selection; primeiro testar que troca entre cargos e setores não cria comportamento injusto.

## Modo READY_IDLE comprovadamente compatível em arquitetura

Timefold 2.8.0 é biblioteca Java (21+) oficialmente integrável com Quarkus 3.x; Java 21 AArch64 tem builds de runtime Eclipse Temurin. Quarkus SmallRye Health oferece /q/health/ready, /q/health/started e /q/health/live. SolverManager é assíncrono e permite terminateEarly por problemId. Isso permite manter Quarkus iniciado, sem otimização ativa, aceitar uma geração imediatamente quando os recursos autorizarem. O startup da combinação exata ainda não foi medido na A1 nem comprovado pela CI.

Configuração a validar na PoC, sem ativá-la em produção:
- quarkus.timefold.solver-manager.parallel-solver-count=1 (evita AUTO); limitar também fila por admissão independente do SolverManager.
- quarkus.timefold.solver.move-thread-count=NONE (sem paralelismo extra de moves); uma tarefa de solve ativa.
- quarkus.timefold.solver.daemon=false. O `daemon=true` do Timefold significa pausa em um *problema contínuo*, esperando mudança de fatos, e NAO hiberna a JVM ou reduz consumo residente como ocioso.
- quarkus.timefold.solver.termination.spent-limit=12s para caminho normal após confirmação de equivalência de semântica e duração.
- Quarkus empacotado para JVM production-mode; teste de ready idle com pressões reais de host e cold start em cgroup limitado. Startup nao pode usar toda a CPU durante a geracao de PDF/outros projetos.

Metas propostas para teste, não resultados: admissão READY_IDLE p95 <=1s, solve start <=2s; apenas se scale-to-zero for aprovado, readiness cold p95 <=5s e hard timeout 10s. Se o objetivo de cold não for cumprido, manter JVM aquecida e bloquear desligamento físico automático. Contabilizar uso residual real de RAM da JVM.

Timefold `SolverManager` nao inicia processo ou container e Quarkus `daemon` nao substitui supervisor. O endpoint HTTP de cancelamento e a operacao assincrona do Next.js exigem adaptador, cuja semantica precisa ser provada. [Detalhes do fluxo](ATIVACAO-INTELIGENTE-TIMEFOLD-A1-2026-11-25.md).

Fontes: https://docs.timefold.ai/timefold-solver/latest/frequently-asked-questions ; https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/library/quarkus ; https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/library/library-integration ; https://quarkus.io/guides/smallrye-health/ ; https://adoptium.net/supported-platforms/ .

## Margem de CPU e memória: NÃO prometer folga sem mensuração

O Compose atual do PerfectUtilitares dá ao OR-Tools Python: 1 vCPU, 1536 MiB RAM, 64 PIDs, serviço interno, root filesystem read-only e tmpfs de 32 MiB. A mesma quota da JVM **não garante** disponibilidade, pois JIT, heap, metaspace, threads e GC consomem memória além do heap.

Ensaios obrigatórios e separados:
- Etapa A: execução ISO-RECURSOS, Python e JVM individualmente em 1 vCPU/1536 MiB, sem competirem entre si. Medir possibilidade de rodar o contrato atual.
- Etapa B: no host A1 COMPARTILHADO (4 OCPUs ARM64/24 GB, também usado por outros projetos), testar primeiro cota piloto de 0,50-0,75 OCPU e 1,0-1,5 GiB, com no máximo um solve ativo. Isso é uma hipótese experimental: se o solver precisar de mais recursos, medir em staging isolado e NÃO aumentar a produção automaticamente. Nenhum ensaio reserva 2 OCPUs ou 3-4 GiB da VM como padrão.
- Exigir no mínimo cerca de 25 a 30% de margem medida em RSS/cgroup, CPU e filas no p95 de cenários suportados; política exata de SLO e mínimo de reserva dependem da observabilidade real.
- Heap inicial controlado por Xmx ou MaxRAMPercentage com suficiente margem para metaspace, stacks de threads, código JIT, buffers e cache; não assumir que heap equivale a RSS. Ajustar ao p99, OOMKills e GCTime, não apenas ao pico de um ensaio.
- Limitar a uma otimização ativa por instância. Não manter OR-Tools e Timefold executando cenários pesados juntos na mesma máquina com memória insuficiente.
- JVM em modo de PRODUÇÃO com JIT C2: a FAQ Timefold registra dev mode Quarkus até 10x-50x mais lento em casos de busca. Aquecer 1-2 solves sintéticos e registrar tempo frio e aquecido, sem excluir custo de startup do contrato.
- Benchmarks com 10/1, 50/4, 115/6, até 250/6, e casos adversariais. Medir p50/p95, RSS, GC, CPU, init e duração, com cinco ou mais repetições e seeds controladas. Guardar só métricas agregadas e hashes de fontes. Nenhum payload de funcionário em artifacts.

## Ativação sob demanda sem competir com outros projetos

O Timefold não precisa otimizar continuamente: SolverManager pode ficar ocioso e consumir CPU de busca apenas quando há requisição. Com memória do host escassa, uma etapa posterior opcional pode iniciar o container no primeiro pedido e pará-lo após ociosidade confirmada. Isso requer controlador externo seguro e testes de cold start; Quarkus/Timefold NÃO iniciam Docker automaticamente, e o backend Next.js não deve ter o Docker socket. Admitir carga somente após verificar memória disponível, PSI CPU/RAM e utilização recente, com fila limitada e cancelamento cooperativo; sob pressão, preservar a escala e rejeitar/adiar o cálculo. Especificação e testes: [ATIVACAO-INTELIGENTE-TIMEFOLD-A1-2026-11-25.md](ATIVACAO-INTELIGENTE-TIMEFOLD-A1-2026-11-25.md).

## Segurança e operação: extensão não substitui os contratos

- Bearer token do serviço atual é um segredo de arquivo protegido; não instalar Quarkus OIDC/JWT por reflexo. Implementar filtro HTTP dedicado com leitura sem seguir symlink, checagem de permissão e comparação constante do segredo, além de testes de token duplicado/inválido. Quarkus oferece mecanismos OIDC, mas eles não resolvem esse protocolo opaco existente.
- /solve recebe somente JSON com entrada validada e tamanho limitado; /cancel preserva requestId+cancelToken e estado atômico de cancelamento. SolverManager.terminateEarly é a parte nativa de parada; continuar a testar que a operação de fato libera a vaga e que um cancelamento não volta como COMPLETED.
- Não abrir portas externas. Quarkus /q/health, /q/metrics e eventual interface management devem permanecer acessíveis só na rede interna do serviço, com auth/segmentação apropriada; nenhuma métrica com nome, matrícula ou entrada JSON.
- Preservar container read-only, uid não privilegiado, CAP_DROP ALL, no-new-privileges, limites de CPU, RAM/PIDs, health, CVE fixes e restart seguro.
- Diagnóstico de falha: devolver códigos não sensíveis, sem stack trace ou modelo, sem relatar INFEASIBLE por mera terminação de heurística.

## Segurança de dependências e cadeia de build

- Maven Wrapper com versão fixa; dependências e plugins governados pelas BOMs + verificação de árvore e duplicatas antes de merge. O build não deve baixar versões mutáveis de runtime.
- CI adiciona compile, unit/ConstraintVerifier, native-independent REST tests, package, SBOM, vulnerabilidade, licença, Docker digest e teste de arquitetura am64/arm64 conforme host. Não exigir GraalVM/native build para o primeiro runtime.
- Maven Enforcer para JDK 21, versões estáveis e convergência de dependências. Relatório SBOM CycloneDX e scan de imagem Docker podem ser ativados no CI sem virar dependência runtime.
- Toda atualização de Timefold/Quarkus exige executar novamente os benchmarks e testes de paridade, não só as verificações de Maven.

## Plugins de build Maven: conjunto mínimo, com os papéis definidos

O plugin de build não entra no classpath de runtime do Timefold. Fixar a versão de cada plugin no POM e ativar objetivos em fases apropriadas, sem duplicar execuções configuradas pela plataforma Quarkus.

| Plugin Maven | Grupo/artefato | Quando usar |
| --- | --- | --- |
| Quarkus Maven Plugin | io.quarkus:quarkus-maven-plugin | Empacotamento Quarkus em modo production, geração de código e builds testáveis |
| Compiler | org.apache.maven.plugins:maven-compiler-plugin | Compilar para release Java 21 e impedir bytecode de versão incorreta; Quarkus gerencia configuração básica |
| Surefire | org.apache.maven.plugins:maven-surefire-plugin | JUnit e ConstraintVerifier na fase test, sem fork ou plugins extras de execução se desnecessário |
| Failsafe | org.apache.maven.plugins:maven-failsafe-plugin | Testes de integração Java/REST no verify, só se necessário separá-los do Surefire |
| Enforcer | org.apache.maven.plugins:maven-enforcer-plugin | requireJavaVersion, requireMavenVersion, requirePluginVersions, requireReleaseDeps, dependencyConvergence; não encobrir conflitos Quarkus/Timefold |
| Dependency | org.apache.maven.plugins:maven-dependency-plugin | dependency:tree para comparar versões transitivas e evitar dupla versão Jackson/Quarkus |
| CycloneDX | org.cyclonedx:cyclonedx-maven-plugin | Gerar SBOM no CI de release sem depender de exportação de dados de RH |
| Versions | org.codehaus.mojo:versions-maven-plugin | Apenas auditoria controlada de upgrades; não atualizar automaticamente dependências no runtime |

Usar Maven Wrapper para a versão Maven escolhida e exigir plugins versionados. Não adicionar checkstyle, SpotBugs, OWASP Dependency Check e ferramentas de análise estática em massa antes do primeiro build: aproveitar os checks já existentes no repositório e introduzir cada gate adicional somente quando houver um caso não coberto. Segurança de dependências é obrigatória; ferramenta específica pode ser definida na CI após detectar cobertura existente.

**Compatibilidade ainda não provada em build:** a matriz Timefold 2.8.0 × Quarkus 3.40.1.2 × Java 21 foi confirmada em documentação de compatibilidade de linhas principais (Timefold 2.x/Quarkus 3.x/Java 21+), mas ainda precisa compilar/testar com versões exatas no spike G1. Não confundir compatibilidade anunciada de linhas com build aprovado.

Fontes:
- https://quarkus.io/version/3.40/guides/quarkus-maven-plugin/
- https://maven.apache.org/surefire/
- https://maven.apache.org/enforcer/enforcer-rules/requireJavaVersion.html
- https://maven.apache.org/enforcer/enforcer-rules/dependencyConvergence.html
- https://cyclonedx.github.io/cyclonedx-maven-plugin/

Auditoria do uso das métricas atuais: [PROTOCOLO-PARIDADE-ORTOOLS-TIMEFOLD-2026-11-25.md](PROTOCOLO-PARIDADE-ORTOOLS-TIMEFOLD-2026-11-25.md). A métrica de desfalque estimado não substitui a avaliação de cobertura confirmada/protegida; todos os resultados Timefold serão validados pelo código TypeScript original.

## Referências oficiais verificadas

Timefold:
- https://github.com/TimefoldAI/timefold-solver/releases/tag/v2.8.0
- https://docs.timefold.ai/timefold-solver/latest/frequently-asked-questions
- https://docs.timefold.ai/timefold-solver/latest/quickstart/quarkus/quarkus-quickstart
- https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/library/quarkus
- https://docs.timefold.ai/timefold-solver/latest/using-timefold-solver/benchmarking-and-tweaking
- https://docs.timefold.ai/timefold-solver/latest/running-timefold-solver/solver-diagnostics
- https://docs.timefold.ai/timefold-solver/latest/quickstart/service/getting-started
Quarkus:
- https://quarkus.io/releases/
- https://quarkus.io/blog/quarkus-3-40-1-2-released/
- https://quarkus.io/guides/telemetry-micrometer/
- https://quarkus.io/guides/smallrye-health/
- https://quarkus.io/guides/validation/
