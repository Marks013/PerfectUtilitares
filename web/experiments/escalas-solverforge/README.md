# PerfectUtilitares — SolverForge experimental E2-SF1

**Não é um serviço produtivo.** Ramo independente de Timefold, sem acesso a Oracle A1, dados de RH, PostgreSQL, credenciais, rotas Next.js ou Compose. O único consumidor é o comparador sintético no GitHub-hosted ARM64. A comparação usa a biblioteca Rust nativa, não um substituto escrito à mão ou wrapper Python.

## Instalação e proveniência

- Upstream: [SolverForge v0.31.2](https://github.com/SolverForge/solverforge/tree/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e), commit exato 78889c3ff9fda158c70e6a1f67f8c7f0fdae922e, Apache-2.0. [Crate 0.31.2](https://docs.rs/crate/solverforge/0.31.2). A MSRV é Rust 1.95; a toolchain do upstream nesta tag é 1.99.1. Usar esta última. Não instalar CLI/scaffold/UI/MCP/mapas.
- Cargo.lock: cópia do workspace upstream na tag, com a entrada do pacote local e a única correção de segurança revisada: anyhow 1.0.102 → 1.0.103 (RUSTSEC-2026-0190, checksum oficial). O script prepare_workspace.py verifica o checkout limpo, SHA e igualdade byte a byte após reverter exclusivamente a correção e a entrada local, depois aplica o overlay em examples/perfectutilitares-solverforge-spike. As bibliotecas SolverForge vêm dos paths oficiais da tag (não de HEAD/main). Dependência direta adicional: serde_json = 1.0.149, já presente no lock. Resolver o grafo inteiro novamente seria erro.
- No runner descartável, instalar toolchain via rustup, alvo aarch64-unknown-linux-musl e musl-tools/binutils via APT assinado. Registrar versão do compilador/linker e pacotes. Cargo fetch --locked baixa as dependências verificadas pelo lock; os testes e build release rodam --locked --offline. Build falha em divergência do lock. Arquivo Cargo.toml depende do workspace oficial, não é um pacote standalone para cargo install.
- O binário deve ser ELF AArch64 sem INTERP/NEEDED, com SHA-256 registrado. Imagem scratch apenas com o binário, usuário 1001, sem shell, biblioteca de sistema dinâmica ou banco. O linker e a stdlib estática ainda precisam de auditoria própria; não concluir que imagem scratch significa ausência de vulnerabilidades.
- OSV consulta somente coordenadas públicas do grafo Cargo alcançável, inclui dependências de build/test, licença declarada e checksums. Inconclusivo/avisos falham. Rust std, compilador, musl e distribuição legal dos notices não certificados. Não publicar a imagem.

## Reproduzir no ambiente descartável

O workflow [escalas-solverforge-experiment.yml](../../../.github/workflows/escalas-solverforge-experiment.yml) é a execução canônica, com identidades e quotas. Para reproduzir **apenas o build** numa máquina ARM64 de laboratório com rustup, musl-tools e binutils (não na A1):

```sh
git clone --depth 1 --branch v0.31.2 https://github.com/SolverForge/solverforge.git /tmp/solverforge-e2
python3 prepare_workspace.py /tmp/solverforge-e2
rustup toolchain install 1.99.1 --profile minimal --target aarch64-unknown-linux-musl
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc
export RAYON_NUM_THREADS=1
cargo +1.99.1 fetch --locked --manifest-path /tmp/solverforge-e2/Cargo.toml
cargo +1.99.1 test --locked --offline --release --target aarch64-unknown-linux-musl --manifest-path /tmp/solverforge-e2/Cargo.toml -p perfectutilitares-solverforge-spike
cargo +1.99.1 build --locked --offline --release --target aarch64-unknown-linux-musl --manifest-path /tmp/solverforge-e2/Cargo.toml -p perfectutilitares-solverforge-spike
```

## Estrutura

src/wire.rs admite estritamente o recorte E2; src/model.rs expõe uma fachada para patterns.rs (domínios legais), coverage.rs (pontuação e verificação integral) e seed.rs (construtor limitado); src/domain usa planning_model!, planning_entity, planning_solution e um Collector público incremental de grupos. src/score.rs adapta BendableScore<1,8> ao ParseableScore exigido na versão 0.31.2, sem mudar a aritmética ou a prioridade dos nove níveis. src/main.rs usa solve_with_config da biblioteca, valida a resposta, lê cgroup v2 e aplica limite monotônico. solver.toml contém seed37, reproducible, move_thread_count none, e limite 12s (reduzido ao residual em segundos inteiros, nunca estendido). RAYON_NUM_THREADS=1 e quota cgroup 1 CPU. O adapter retorna o JSON já esperado pelo aplicativo e telemetria própria; não inventa eventos de primeiro incumbente.

Os hard rules individuais são expressos como domínio de padrões legais por pessoa, não como milhares de decisões independentes; cobertura confirmada permanece hard. Score lexicográfico de 1 hard e 8 soft: desfalque dominical, falta de presença diária (setores >=2), desfalque total, pico setorial, excesso ajustável de pares, pares ajustáveis, spreads dominicais e mudanças salvas. Sem relaxamento de locks. Esta ordem é hipótese do candidato, não port completo dos 16 objetivos nem cópia da pontuação interna de Timefold. A régua externa é a mesma e decide regressões.

## Otimizações e verificação

Domínios admissíveis são enumerados com poda de prefixos e mantêm os índices e a ordem do catálogo original; slices Arc compartilhadas por perfil evitam cópias no modelo. Testes comparam cada domínio com a enumeração exaustiva. O coletor incremental usa índices de bandas por dia, presença, pares e contadores dominicais reversíveis; coverage.rs conserva a recomputação integral independente. Testes verificam o resultado após cada inserção, retirada, troca e reset. Não extrapolar o custo para seis semanas: o domínio de E2 continua limitado a 7/28 dias e 50 pessoas.

A auditoria OSV cobre também todo o lock de crates.io, explicitando alcance e achados históricos. O gate falha se houver avisos ou o registro RustSec anterior permanecer aberto; compilador, stdlib, musl e notices continuam pendentes. Não atualizar o lock upstream silenciosamente.

## Benchmark

Controle CP-SAT f78c691edbeaf16283f534bcacd8db1b4b7d5e66; Timefold 71945cd6e73c48b424dab1297fbc3bf8a15ae585 (E2.5, validado na qualidade sintética; auditoria JDK daquela imagem era inconclusiva). Usar somente as duas imagens isoladas reconstruídas dos SHAs, sem juntar código Java ao Rust. O comparador core.ts e fixtures.ts permanecem byte-idênticos ao controle; o verificador Rust calcula p50 pela mediana e apresenta deltas pareados de qualidade e recursos. A referência zero não recebe percentual artificial. 6 ordens dos três motores por caso, um container por vez, 1 CPU/1536 MiB/64 PIDs, prazo normal 12/18/20s, payload 8 MiB. Casos 10/7, 50/28 e reparo 10/7. Timefold usa PATTERN no 50/28 e DEFAULT nos demais, como seu gate aprovado. Seed-only Rust separado no 50/28 para atribuição de ganho; nunca contar esse controle como busca nativa. O diagnóstico adicional executa cinco ordens rotativas de seed-only e budgets nativos 2/4/8/12 s, reportando válidos, faltas, tempo de mapeamento/seed/busca, CPU e memória. É uma curva interna do candidato, não comparação equitativa com outros motores em budgets reduzidos; fracassos não contam como melhoria. Verificar dados brutos, cgroup, seleção original, regressões setoriais e custo de falta normalizado. As 6 repetições são exploratórias, não certificam p95/p99, equivalência E3, desempenho de produção ou vencedor global. Reprovação é evidência; não alterar o gate ou a referência para escondê-la. Compare o modelo nativo com a seed; se não houver ganho, questione o custo de manter um solver complexo.

Não há benchmark aprovado neste commit até execução efetiva do Cargo, smoke e workflow. Fora do domínio: horários variáveis, dezembro/cutover, históricos, ausências, jornadas mistas, liderança UNTIMED, proteções privadas, HOURS_ONLY, 115/42 e 250/42; recusados ou não exercitados. Não extrapolar. Antes de expandir, confirmar paridade e ausência de score drift com o modo fast_assert, mapear os demais casos da matriz E0.

### Revisão de paridade dominical

A coorte agora combina setor, cargo, geometria de relógio e cap dominical. Recuperação conjunta de domingos usa projeções de domínios legais, prazo original, guardas de cobertura do setor e comparação independente TS. O gate E2 de não inferioridade é separado da validade e dos diagnósticos. Não certifica equivalência E3 ou produção.

### Contrato comum Java/Rust E2-WIRE-1

26 casos sintéticos (base + mutações JSON Pointer), mesma cópia byte a byte do recurso JUnit em Timefold 7c426f887a3a1424e01d2a3e877bad196e34ecad. O workflow verifica identidade antes do build e o teste Rust executa o mapper, não um mock. Alinhar IDs, limite de catálogo, datas civis 1900–2099, ausência de shiftId em OFF, arrays de histórico e slots inativos. Aceitação pelo mapper não equivale a uma escala viável. Sem JNI/JVM no Rust, sem alteração do contrato público ou do comparador TS. Cargo default features vazio confirmado na tag; Clippy obrigatório para deprecated/unused/dead_code e compilação candidato com -D warnings; formatação automática e demais lints ainda pendentes.
