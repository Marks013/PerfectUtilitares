# SolverForge — instalação reproduzível, arquitetura e gate de avaliação

Data: 25/11/2026. Candidato adicional autorizado para estudo, não substituição automática de Timefold/OR-Tools. Todo o trabalho permanece no PR único #74; sem alteração de aplicação, migrations, Compose produtivo, secrets, dados de RH ou Oracle A1.

## Fonte de verdade e escopo

- [Release SolverForge v0.31.2, 17/11/2026](https://github.com/SolverForge/solverforge/releases/tag/v0.31.2), commit `78889c3ff9fda158c70e6a1f67f8c7f0fdae922e`, Apache-2.0.
- [Cargo.toml da release](https://github.com/SolverForge/solverforge/blob/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e/Cargo.toml), [Cargo.lock](https://github.com/SolverForge/solverforge/blob/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e/Cargo.lock), blob Git 8d748afc1df1702f11d247d471edea6fda9dc4f8. 101 pacotes no lock do workspace inteiro: 87 do registro crates.io e 14 locais (nove crates SolverForge + cinco exemplos). Todos os registros externos possuem checksum. Essa contagem **não** é número de dependências vinculadas ao binário.
- [rust-toolchain.toml](https://github.com/SolverForge/solverforge/blob/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e/rust-toolchain.toml): Rust 1.99.1 exato para CI; piso 1.95. Usar toolchain exato, não stable flutuante.
- [Status e roadmap](https://solverforge.org/docs/status-and-roadmap/): CLI 4.2.2; Python 0.8.1 (CPython 3.14); UI 0.9.1; Maps 2.3.3; MCP rmcp 3.9.0 no scaffold. Não misturar documentação antiga 0.19/0.21 com o código 0.31.2.
- [AGENTS.md](https://github.com/SolverForge/solverforge/blob/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e/AGENTS.md), wireframes de crates e exemplos versionados conferidos; APIs de baixo nível somente quando necessário.

## Dependências e decisão de instalação

| Crate da facade 0.31.2 | Uso |
| --- | --- |
| solverforge | facade pública e prelude; dependência principal |
| solverforge-core | scores e metadados de domínio |
| solverforge-macros | macros de modelo/constraints |
| solverforge-scoring | SERIO incremental |
| solverforge-config | TOML/configuração validada |
| solverforge-solver | fases, movimentos, seletores, manager e telemetria |
| solverforge-cvrp | transitivo obrigatório da facade nesta release, mas sem lógica de rotas na escala |
| solverforge-console | opcional; desabilitar em serviço JSON |
| solverforge-bridge | contratos para bindings, não necessário para native Rust |

Manifest da facade: default features vazias; features serde, console e verbose-logging opcionais. Não há necessidade de instalar um servidor SolverForge completo, CLI, UI, Maps, Python, MCP ou banco adicional para usar o motor. Esses projetos são componentes distintos. Preferência por Rust nativo e processo isolado, sem FFI com Node ou Python, para aproveitar a tipagem estática e evitar upgrade de Python produtivo. No futuro adapter, usar serde/serde_json apenas após resolver lock próprio e auditar o grafo; não presumir que serde da facade resolve o contrato wire da aplicação.

Versões observadas no lock oficial, não apenas intervalos do manifest: rayon 1.12.0, tokio 1.54.1 (manifest 1.52.1 permite resolução superior), rand 0.10.1, smallvec 1.15.1, serde 1.0.228, toml 1.1.2+spec-1.1.0, tracing 0.1.44, syn 2.0.117, quote 1.0.45, proc-macro2 1.0.106, thiserror 2.0.18. O inventário CI registra licenças, features e checksums reais do lock e a closure conservadora da demo. Features podem ser unificadas no metadata do workspace; cargo tree específico do pacote também registrado. Não afirmar dependências compiladas/alcance de vulnerabilidades a partir do lock inteiro. Licenças transitivas precisam de revisão antes de redistribuição.

## Banco de dados e integração PerfectUtilitares

Conferidos `web/prisma/schema.prisma`, migrations de Escalas, `web/src/lib/escalas/solver-transport.ts` e `web/ops/escalas/runtime_settings.py` no SHA da aplicação congelada e na branch experimental. **Não foi acessado o banco real, .env, tokens ou registros de colaboradores.** O PostgreSQL existente segue como fonte de verdade.

| Tabela/modelo | Responsabilidade, sem acesso direto pelo solver |
| --- | --- |
| EscalaWorkforce / EscalaImportedTeam | snapshots de equipe e revisão/origem |
| EscalaWorkspace | tenant, filial, período, revisão atual, estado |
| EscalaRevision | histórico de input JSON, autorização, estado e política aprovada |
| EscalaBranchPolicyVersion | política aprovada, hash e versão, revogação |
| EscalaSolveOperation | dono, expectedRevision, estado/cancelamento, expiração |
| EscalaBranchAccess / EscalaOperator / EscalaOperatorBranchGrant / EscalaModuleSession | autorização por tenant/filial, sessão e escopo |

Aplicação continua consultando Prisma, preparando e validando o envelope privado, autorizando operação, mantendo expectedRevision e persistindo exclusivamente resultado validado. Solver recebe snapshot de cálculo sem credencial de banco, devolve proposta, não grava banco nem importa cadastros. Contrato atual: POST /solve e /cancel, Bearer secreto por arquivo, cancelToken HMAC, input máximo 8 MiB, 12/18/20 s normal; 23/27/32 s reparo especial; cancel 3,5 s. Respostas FEASIBLE/UNKNOWN somente no recorte heurístico (não inventar OPTIMAL/INFEASIBLE), validação TS externa, proteção de referência, CANCELLED/TIMED_OUT etc mapeados explicitamente. Modo do motor não vem do payload público. Escalas somente horário sem grade não são problema de solver. Nenhum endpoint novo ou alteração de DB até E3/E5.

## Modelagem adequada ao domínio

O exemplo oficial `examples/minimal-shift-scheduling` usa fatos, entidade de turno, `Option<usize>`, `#[planning_pin]`, grupo de atribuição, `consecutive_runs`, `group_by` e `complement`. O exemplo não representa regime 5×2 completo nem política brasileira. Não reutilizar sua semântica como produção.

Proposta para o spike real: padrões semanais individuais, domínios legais específicos por pessoa, semana e turno; entradas inválidas recusadas. `value_range_provider` define domínio efetivamente legal; `candidate_values` apenas orienta a busca e não restringe swaps. Evitar enumeração cartesiana de seis semanas (15^6 = 11.390.625 máscaras brutas por pessoa). Construir padrões semanais com transições que respeitem descanso e histórico. Preservar pins e horários, registrar fatos de cobertura por banda/sector/cargo e incluir casos zero. Guardas hard obrigatórias e pesos lexicográficos `BendableScore` conforme inventário E0 e política real, sem transformar toda demanda estimada em hard. Mapear índices internos para IDs do wire; não usar nomes como identidade.

O [guia de configuração versionado](https://github.com/SolverForge/solverforge/blob/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e/docs/configuration.md), [modeling](https://github.com/SolverForge/solverforge/blob/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e/docs/modeling.md), [running-solves](https://github.com/SolverForge/solverforge/blob/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e/docs/running-solves.md) e [performance](https://github.com/SolverForge/solverforge/blob/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e/docs/performance.md) confirmam grupos de movimentos, selectors agrupados/compound conflict repair/ruin-recreate, telemetria de fases e avaliação paralela. Usar `fast_assert`/ `full_assert` em testes para verificar drift incremental, `reproducible` e seed 37 em benchmark, `move_thread_count = "none"` e RAYON_NUM_THREADS=1 na primeira comparação. Para sensibilidade com 2 CPUs, testar `move_thread_count = { count = 2 }` e RAYON_NUM_THREADS=2, mesmas quotas para os três motores e ordem alternada. Não usar auto inadvertidamente para mudar recursos. Termination explícita: 12 s incluindo adapter/mapper e margem externa, sem tempo implícito; override somente do servidor. Em runtime usar manager e evento terminal, validar score e completude, cancelar e remover job; não tomar mera existência de snapshot como conclusão. Manter watchdog externo, mesmo com cancelamento cooperativo upstream. Não habilitar pausa/resume/realtime problem changes sem caso de negócio e prova da segurança de estado.

## Instalação real preparada, mas não certificada

Pasta `web/experiments/escalas-solverforge/` contém configuração específica da demo, script de instalação, Dockerfile mínimo, verificador independente e testes. Workflow ARM64 novo dentro do mesmo PR:
1. checkout isolado da release oficial, verifica commit e blob de Cargo.lock, instala Rust 1.99.1;
2. cargo fetch --locked, metadata e cargo tree em modo offline/locked, valida sources/checksums e inventário de licenças;
3. [RustSec cargo-audit 0.23.0](https://github.com/rustsec/rustsec/releases/tag/cargo-audit/v0.23.0), binário oficial aarch64 com SHA-256 00eff3158429b9629abe8748e971f29f99ee53d4cff54a25072cbb15167bdda8; baixa [RustSec Advisory Database](https://github.com/RustSec/advisory-db), registra commit/data, audita o lock inteiro antes da compilação, sem filtros/ignore, --deny warnings, resultado inconclusivo não aprova. Verificador confere versão do banco, contagem, filtros e resultado. Não é auditoria de toolchain Rust, código local, glibc/OS ou alcance no binário; esses gates permanecem antes da integração.
4. usa o exemplo upstream real e altera somente seu solver.toml: fast_assert, seed 37, move_thread_count none, limite 5 s e fases do exemplo, não configurações inventadas. Executa os testes de pinning/mandatoriedade upstream e build release offline sem mudar Cargo.lock; arquivos de código upstream permanecem íntegros. RAYON_NUM_THREADS=1. Compilar com Cargo offline não isola código de build arbitrário; runner descartável sem credenciais produtivas.
5. empacota somente executável e licença numa base Ubuntu 24.04 fixada por digest; roda como UID1001 sem rede/volumes, read-only, cap-drop ALL, 1CPU, 1536MiB, 64 PIDs; supervisor 7+1s e limite externo 10s. Verificador externo reconstrói grade sintética de 3 pessoas × 6 dias × 2 turnos, exige 12 atribuições, zero hard/soft, nenhuma duplicação diária, quatro dias por pessoa e máximo dois dias consecutivos. Não é tempo de benchmark PerfectUtilitares. Evidências públicas/sintéticas somente. Sem dados reais.
6. Somente se passar, adaptar o envelope real e portar semântica parcial idêntica E2; comparar primeiro apenas o mesmo 10/1 e 50/4, depois casos completos. Não adicionar adaptador ao seletor produtivo agora. Cargo.lock próprio obrigatório antes de usar crate publicada, hoje usa workspace oficial travado. Ambiente de conversa não dispõe de Cargo/Rust/Docker; testes da instalação real dependem do GitHub Actions.

## Comparativo publicado e decisão

[INRC-II de 19/11/2026](https://solverforge.org/benchmarks/), 37 instâncias, harness 94bccba67924, run 28b1cb08-03f4-4148-87f5-4ca6f32ebf4a, interessado: em 1s SolverForge 35/37, Timefold 6/37, OR-Tools 3/37; em 10s SolverForge e Timefold ambos 37/37, custos médios 34604,46 vs 18491,35 (Timefold ~46,6% menor); OR-Tools apenas 3/37, custos não comparáveis de subconjuntos. A 60s, 37/37 em ambos, custos 17742,97 vs 16254,32. Gates incluem retornos tardios, não são SLA. Versões Rust 0.31.2, Timefold 2.8.0, OR-Tools 9.15.6755; bindings Python testados 0.7.2, não presumir 0.8.1. Inferência limitada: potencial de factibilidade rápida e paralelismo, não superioridade geral. A implementação produtiva CP-SAT é especializada e não pode ser equiparada ao adapter do benchmark externo.

Nosso controle Timefold E2.5 (71945cd, 45732100246) tem 18,75% menos desfalque, 0 regressões em 5 PATTERN e 6 históricas, mas não cobertura completa E3. Próximo diagnóstico isolado do construtor ainda bloqueado pelo build JDK; não atribuir todo ganho ao Timefold. Conservar ambos os candidatos, comparar na mesma infraestrutura e orçamento com o validador original. SolverForge deve demonstrar benefício real, sem sustentar terceira stack produtiva desnecessária. Manter critérios e gates de substituição já definidos, holdouts, 100% validade e ausência de regressões, capacidade da A1 e autorização humana; parar candidato que não se justifique.

## Correção pendente do JDK Timefold nesta revisão

No SHA da59fad, os 13 testes do auditor JDK e 16 do verificador E2 passaram; workflows de build pararam em verify-jdk runtime, antes de benchmark/varredura. A instalação APT passou, mas o script anterior não identificava a condição exata. Reproduzida em ambiente local Debian minimal a falha dpkg --verify por arquivos de documentação/lintian ausentes, compatível com hipótese de path-exclude da imagem Ubuntu; não afirmada como causa exata do runner sem logs. A correção solicita --path-include=* na instalação JDK/JRE para preservar arquivos do pacote, adiciona códigos de diagnóstico e mantém dpkg --verify sem exceção, inclusive hashes e ownership de java/libjvm/modules/javac. Base Ubuntu, USN e versão fixadas, scanner e gates permanecem. Caso a verificação ainda falhe, os logs permitirão identificar a condição concreta. Nenhuma alteração no algoritmo Timefold ou OR-Tools.

PR único #74, draft, base main. Nenhum novo PR ou deploy.
