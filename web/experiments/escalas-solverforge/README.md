# PerfectUtilitares — SolverForge experimental E2-SF1

**Não é um serviço produtivo.** Ramo independente de Timefold, sem acesso a Oracle A1, dados de RH, PostgreSQL, credenciais, rotas Next.js ou Compose. O único consumidor é o comparador sintético no GitHub-hosted ARM64. A comparação usa a biblioteca Rust nativa, não um substituto escrito à mão ou wrapper Python.

## Instalação e proveniência

- Upstream: [SolverForge v0.31.2](https://github.com/SolverForge/solverforge/tree/78889c3ff9fda158c70e6a1f67f8c7f0fdae922e), commit exato 78889c3ff9fda158c70e6a1f67f8c7f0fdae922e, Apache-2.0. [Crate 0.31.2](https://docs.rs/crate/solverforge/0.31.2). A MSRV é Rust 1.95; a toolchain do upstream nesta tag é 1.99.1. Usar esta última como referência; a CI SF61 qualifica também o Rust estável 1.100.0 com o mesmo lock. Não instalar CLI/scaffold/UI/MCP/mapas.
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

### E2-SF3: estratégia nativa adaptativa isolada

Modo --adaptive (somente diagnóstico, orçamento 12 s): usa a terminação nativa por um segundo sem melhoria quando a solução inicial completa é válida. Compara o resultado nativo com o incumbente próprio, preserva cada faixa/data de demanda representada, presença e métricas setoriais; em empate protege descanso/rodízio. Se houver regressão, devolve o incumbente com resultSource SEED_RETAINED e registra nativeCost separadamente. Score drift continua sendo erro, nunca mascarado. Sem seed válida, busca usa prazo completo. Curva de seis variantes (36 ensaios) compara cada resultado tanto com seed-only quanto native-12 pelo seletor TS congelado. Default não alterado. A cópia E2-WIRE-1 é verificada pelo blob Git fixado, sem exigir fetch do PR Java. O modelo continua parcial, não corresponde aos 16 objetivos ou E3/E4, e os ganhos exigem CI ARM64.

### E2-SF4: recuperação conjunta e fundações de escala

Reparo dominical por beam de coortes, 16 estados, até 300000 projeções por setor, até seis reconstruções em duas ordens; cache de assinaturas e tabela semanal de ganhos. Proteção por faixa/função e métricas detalhadas. Presença usa 256 bits; autômato semanal conta domínios de seis semanas sem produto cartesiano; E2 mantém enumeração de IDs apenas em 7/28 dias. Testes diferenciais e de componente 115/250 não significam suporte integral de escala. O benchmark de cauda de 32 repetições só roda após não inferioridade e auditoria OSV. Consultar AUDIT.md para critérios não comprovados.

### E3a: parâmetros individuais em relógio fixo

Admite 40/42/44h em novembro (cinco dias de 480/504/528 min, sem exceder limites diário/semanal), referência única ou importada fixa entre opções, modos DAYS_AND_HOURS e REST_ONLY com relógio fixo. Folgas VARIABLE/MIXED/FIXED, slots habilitados consistentes, dia da semana Monday=0 convertido para Sunday-first, OFF obrigatório, CONSECUTIVE, PREFER_CONSECUTIVE, preferredOffDays e limite contínuo configurado (1–6, cap 5). Folga fixa sábado é conflito explícito, nunca desbloqueada. Domínio usa PersonalRules compartilhadas no autômato e no verificador exaustivo; custos de espaçamento somente VARIABLE/ANY; score de 11 níveis separa pessoas alteradas, dias alterados e preferências depois da qualidade operacional. Testes reais native fast_assert para três jornadas, perfis mistos e rejeições. E3a não é E3 integral: permanecem horários variáveis, simulação curta/mista 42, HOURS_ONLY variável, histórico, vínculo parcial, feriados/ausências, acordos, calendário amplo e demais objetivos/guardas. Mantém recorte sintético, 7/28d e 50 pessoas; sem release.

O corpus E3A-FIXED-CLOCK-1 é idêntico ao recurso JUnit do Timefold (997d79d70781084c1547cacdb7b7e037163676b6, blob 2972584ac91979b65bb7782aa8374fcbb86f7b90); inclui 40/42/44h simultaneamente, três perfis individuais e seis mutações negativas. O teste Rust usa a busca nativa e recomputação independente do score. Os resultados dependem da CI do novo commit.

### E3a.1: distribuição de folgas e comprovação adaptativa

Pontuação de 13 níveis: hard, domingo, presença, total, pico, excesso de pares, pares ajustáveis, concentração, repetição semanal, equilíbrio dominical, pessoas alteradas, dias alterados, preferências. Os quatro termos de descanso têm equivalência aferida com restAudit do TypeScript no escopo sem histórico/padding. Novo reparo bounded (até 200 mil tentativas) usa trocas em dias úteis, singles sem piora de gaps/faixas/presença e pares entre colegas de geometria/função idêntica com serviço exato preservado. Não altera domingos, bloqueios, jornadas ou preferências; preserva excesso individual e total de grupo. Teste nativo com duas pessoas e demanda confirmada em que somente troca conjunta pode melhorar, e teste de folgas bloqueadas. A proteção adaptativa usa grupos do produto (setor/cap/jornada) além de score e bandas. Benchmark de 32 pares native-12/adaptive exige ausência de regressões/retenções contra ambos os controles e native-12, redução mediana pareada >=25%, redução P95 >=25% e CPU mediana não maior. Mede mesmo quando o gate E2 anterior reprova, após auditoria de dependências e build; não relaxa a aprovação geral. Critérios diagnósticos, não certificação de produção.

### E3a.2: ajuste de horários com referências fixas

HOURS_ONLY é admitido quando existe grade completa e cada participante possui um único relógio efetivo. Domínio unitário preserva cada WORK/OFF e bloqueio original; turno antigo conhecido pode ser substituído apenas no WORK editável. Não marcar todas as folgas como impostas para o score. Grade incompatível é recusada, sem alterar dias. REST_ONLY admite múltiplos relógios de igual duração, preservando o primeiro por duração como no Python; alternativas de duração distinta continuam fora do recorte. Testes positivos/negativos no mapper e na resposta serializada. Não é ajuste variável, nem porta para histórico/ausência/feriado.


## SF54b: opt-in temporal proof of concept (not E3/E4 parity)

`--temporal` is a separate synthetic-only native planning model with 1 hard
and 16 named soft positions, using enumerated legal weekly patterns and
concrete work segments. The legacy fixed-clock E2 adapter is unchanged.
Admitted scope: 1–12 timed synthetic people, 2026-11-01 through 2026-11-07,
SUNDAY, rest rules v3, CUSTOM/MANUAL simulated policy; up to 4 normal clock
alternatives per person and 12 globally. It distinguishes OFF, ABSENCE,
HOLIDAY and WORK; preserves existing manual absences and locks. Includes
40/42/44h, mixed 42h (3 × 480 + 2 × 540 in an ordinary full week), actual
daily clock selection, REST_ONLY first per duration, HOURS_ONLY fixed
day kinds, dated holiday/absence reductions and explicit preceding/following
history. Historical context is never emitted as a new assignment.

The scope excludes monthly cutover and multi-week temporal optimization,
partial employment, DUTY/UNTIMED, overnight clocks, manual date-specific
overrides, carry metadata, cross-sector leadership and private reference
guards. Unsupported input is rejected, not relaxed. No production proof,
nor proof of non-inferiority of this model, is asserted. A candidate with
mandatory shortage or incomplete assignments returns UNKNOWN.

The score exposes the original 16 objective names in their original order.
A scoped or partial metric has a numeric cost; an unimplemented or
inapplicable objective reports null and the reason. The scope does not
establish equality of objectives, phase guards or lexicographic policies.

| Objective | SF54b status |
|---|---|
| COVERAGE | Scoped: actual work intervals and role floors |
| SUNDAY_COVERAGE | Scoped: Sunday minutes |
| SUNDAY_PEAK | N/A single week; multi-week per-sector dispersion pending |
| MOVEMENT_COVERAGE | Scoped: explicit day/sector weights |
| CLOSING_COVERAGE | Scoped: last 60 minutes |
| UNTIMED_ROTATION | N/A timed-only; untimed model pending |
| SUNDAY_BALANCE | Partial: cohort rate spread |
| REST_SPACING | Partial: adjustable pairs and excess |
| LEADERSHIP | Partial: local responsibility; high-priority incumbent guard |
| SATURDAY_BALANCE | Partial: cohort rate spread |
| REST_DISTRIBUTION | Partial: sector/role groups |
| REST_ROTATION | Scoped: known historical weekdays |
| PEOPLE_CHANGED | Scoped: saved assignments |
| STABILITY | Scoped: saved kind and clock |
| PREFERENCES | Scoped: preferred OFF and consecutive preferences |
| TIE_BREAK | Pending: exact original SHA-256 rank |

The next gate is original client and frozen OR-Tools parity for every
admitted temporal feature, then multi-week temporal domains and combined
115/250 cases. A passing fixed-clock scale diagnostic alone is not E4.


SF54c: the original frozen client is now the acceptance oracle for a separate
temporal diagnostic: four cases (mixed/variable, holiday/absence/history,
HOURS_ONLY and REST_ONLY), two balanced repetitions of OR-Tools and the
temporal native adapter, 16 cold-container runs. It checks actual raw/final
attribution, resource limits, original validator and quality comparator,
feature-specific invariants and the 16-entry objective audit. Report validity
and paired noninferiority separately; no full E3/E4 claim. The 42-day
diagnostic now reconstructs its separate sector vector from the accepted
proposal using the frozen TS coverage evaluator, since the original E2
client exports that vector only at 7/28 days. No changes to frozen core,
fixtures, production sources, controls, lockfile or quotas.

CI validation of the new temporal code and both diagnostics is required;
do not interpret the earlier SF52 success as approval of this expansion.


## SF54d/e/f — multi-week temporal model and combined synthetic scale (pending qualification)

- The fast native ARM64 workflow on 65547ff reproduced four compiler errors in the prior temporal implementation (TemporalFacts missing PartialEq/Eq/Hash, Pattern missing Hash). Derive the missing structural traits on facts, clocks, bands and patterns. Remove the unused exported TypeScript telemetry type. The new fast workflow is separate from and does not replace the long existing benchmark.
- Generalize the temporal model to 7, 28 or 42 days from the frozen synthetic start, full employment, up to 250 people for the multi-week horizon. Enumerate weekly candidates, assemble up to 384 distinct full-horizon paths per identical profile using 2048 deterministic attempts and at most 64 trials per week, shared by Arc. Check legal weekly minutes, variable-rest repetition across comparable weeks, work streaks, Sundays, intershift/weekly rest, consecutive-rest preferences, history/future and locked dates across boundaries. A failed bounded sample is UNKNOWN, never proof of infeasibility; a selected search domain is not complete. A synthetic dated manual target is admitted without treating it as WORK or widening other days; full provenance and private reference contracts remain unsupported.
- Admit DUTY for untimed/missing-clock employees, counted as presence but never hourly coverage or credited minutes. Add normalized Sunday peak and squared dispersion with a globally dominating safe-integer bound, date-rate Sunday balance, untimed weekday/sunday rotation and the exact original SHA-256 tie-break (verified against Python hashlib oracles, no new dependency). REST_SPACING still uses a conservative excess-first upper-bound coefficient and leadership/rest-distribution remain local approximations, not exact original CP-SAT phase/guard parity.
- Greedy seed uses hard/estimated demand and per-role gains by actual clock; bitsets avoid per-band row map allocation. The native score collector still recomputes a sector; no claim of fully incremental temporal scoring. Preserve a valid seed's operational sector prefix and high-priority local leadership, and revalidate native score. Full original role/time/reference and global leadership guards are not certified.
- SF54f adds two combined 115/42 and 250/42 cases to the four weekly temporal fixtures: variable clocks, mixed 42h, 40/44h contracts, paid holiday, locked absences, history, untimed leaders, movement and confirmed/estimated demand. Two balanced OR-Tools/temporal repetitions per case, 24 total temporal runs (8 added); frozen client/evaluator and immutable controls; independent feature checks, SHA rank, resource quotas, and 42-day sector audit. Diagnostic validity and noninferiority are separate; no P95 claim, no E3/E4 or production certification. Compilation, strict lint, all tests and measured benchmarks must pass before any qualification.
- Remaining: genuine monthly cutover/variable start/partial employment, overnight and paid-break geometry, date-specific provenance, full private coverage contracts, cross-sector leadership and exact phase/guard equivalence, broader holdouts and tails, deployment. No main/Timefold/production modifications.


## SF55–SF57 — correction of the first complete combined-model attempt

Evidence from PR head cb97d22, run 45814929660: 48 Rust tests, 16 Python tests, fixed-clock E2 noninferiority and adaptive gain passed. E2 native/adaptive p95 11.409/2.403s (78.94% reduction). Fixed 115/42 and 250/42: all 18 proposals valid, but every candidate/control pair vetoed by SUNDAY sector coverage (worst observed 0 -> 1008 person-minutes). Native/adaptive equal cost; previous repair discarded 7/17 sector frontiers at the exact projection limit. Adaptive median product latency 2.842/3.642s; estimated shortage 102312/221256 vs OR-Tools 151200/411264. The scale gate was validity only, not noninferiority. Mixed-variable temporal case emitted 4 valid paired observations, both candidate pairs vetoed by role-time service (900 -> 360 person-minutes in one horizon interval); remaining cases were not executed. The fixture put paid holidays on inadmissible dates (November 3 and 20); product schema only admits January 1, May 1 and December 25. Six Clippy chunks_exact_to_as_chunks diagnostics blocked strict lint; no warnings suppressed.

- SF55: use Rust 1.99 as_chunks for six actual lints; civil ordinal calendar for complete Sunday weeks in 2026 before Dec 16, no padded inferred monthly horizon; admit paid holidays only from original product calendar. Weekly holiday case Apr 26–May 2 and combined cases Apr 5–May 16 use May 1 with genuine history and locks. New calendar test rejects the former inadmissible dates and unported transition/padding. Preserve November E2 fixtures. Supplement original evaluator vectors at non-November temporal horizons; when core provides them cross-check byte-for-value agreement. Log case/stage and sanitized schema issues; continue independent cases, fail overall on incomplete evidence.
- SF56: use bounded beam over actual legal Sunday signatures for six weeks only, retaining original count frontier for 7/28. Two sweeps and bounded projected evaluations; do not reduce individual Sunday work counts. Reconstruct within legal domains and retain the original hard/coverage/presence/role/peak acceptance. Unit case 12 same-role employees, six Sundays, requires zero Sunday deficit from a deliberately concentrated roster. This is not evidence of the 115/250 quality gate until CI measures it.
- SF57: seed ranks hard/estimated demand first, then fills empty timed days and prefers actual Sunday service/dispersion; no new demand or invented credited DUTY hours. Temporal native result must improve strictly while preserving valid incumbent sector prefix, high-priority local leadership, timed daily presence, actual role-time service and per-band role deficits/peaks across horizon/Sundays. Recompute before/after with common clock/demand boundaries; decline a lost interval and restore incumbent. Added native acceptance/source telemetry and independently validated evidence; a rejected native move is not native improvement. Unit guard test changes a legal 8h clock without changing total hours and must detect service loss. These conservative guards can restrict improvements; not equivalence to all original phase guards.
- Execute scale/temporal diagnostics early after audit and control builds; existing E2, tail, personal, security, quotas, evaluator, lockfile and controls unchanged. Require separate expanded noninferiority gate after diagnostics, even if validity succeeds. Remaining: obtain measurements from all six temporal fixtures and new scale runs, resolve any regression; still no full E3/E4, overnight, partial employment, monthly transition/cutover, private protection or production certification.

## SF58–SF60 — temporal wire correction, dated calendar and additional objective guards

Evidence for 40bb3dc (run 45826881176): 51 Rust and 17 Python tests and strict Clippy passed; E2 comparison and adaptive tail gate passed. At fixed-clock 115/250 the Sunday deficits fell from 4032/11088 to 1512/3024 person-minutes, and projection-limit losses fell from 24 to zero. Nevertheless sector-level Sunday losses against OR-Tools still vetoed all fixed-scale candidate pairs. Six of twelve temporal candidate observations were valid; HOURS_ONLY and REST_ONLY passed paired comparison, mixed-variable failed role/time service, and all six observations involving scoped history failed EXPECTED_TEXT.

- SF58 (03137f9): scoped history can omit the employee ID because the enclosing employee identifies it; reject a conflicting explicit ID and keep flat assignment IDs mandatory. Index assignments by employee once. Prefer the first reference clock per duration on otherwise equal coverage, and attempt a bounded residual Sunday repair on full legal 42-day patterns. Do not accept new hard/role/Sunday-band deficits, reduced individual Sunday presence, worse total shortage or peak, or increased rest excess. Fast ARM64 workflow 45836488238: 53 Rust tests, strict Clippy passed.
- SF59 (f977458): actual civil dates in 2026–27, full Sunday-first weeks plus the December 2026 partial weeks, explicit/inferred visible month, per-date daily ceiling and per-week effective weekly target at both dated 44/42/40 transitions. Closed paid holiday Christmas and 3-work/2-rest opening partial block are modeled. Same-day night clocks can end within explicit closing time; no overnight or statutory reduced night minute/payroll implementation.
- SF60a (4ea5847): use the original excess-first monthly adjustable-pair coefficient (1 + potential adjustable pairs), month ownership by the second OFF, and per-person, cohort, broader product group, padding and weekend safeguards. Fast ARM64 run 45837247468: 56 Rust and 17 Python tests, strict Clippy and static binary build passed.
- SF60b/c: explicit responsibility may span known sectors; weighted missing-leadership score and high-priority incumbent protection cover those sectors without turning leadership or DUTY into timed work. REST_DISTRIBUTION includes the distinct global leadership label group. Require strict private service floors on actual timed WORK with exact scope and band splitting. Additional tests cover cross-sector leadership and satisfiable/unsatisfiable/invalid service floors. Unknown private fields remain rejected. The incumbent guard also protects total eligible Sunday work by cohort.
- Extend original-client temporal qualification from six cases/24 trials to eleven cases/44 trials (same-day night, 42h and 40h transition weeks, December monthly cutover, cross-sector leadership). Independently reconstruct visible-month and cutover comparison coverage, SHA rank, rest pair totals/weight and weighted missing leadership. Keep original OR-Tools control, original TS client and evaluator, lockfile, quotas, fixed E2 and independent adaptive tail gate. A private service floor is unit-tested; the full original protected December reference envelope has not yet been qualified.

Compilation and all independent pairwise quality gates on this new combined revision remain mandatory. The selected multiday search domain is bounded, not complete. Remaining scope includes actual overnight/civil-day split work, night-credit semantics, partial employment, full original private comparison/recovery/initial-assignment contracts, exact original objective phase semantics (including opening concentration, Sunday peak and guards), broader holdouts and production integration. No E3/E4 certification or production deployment; no edits to main or PR #74.

## SF61 — Rust stable compatibility without dependency drift (2026-11-26)

Official source verification: Rust 1.100.0 was released 2026-11-12
(https://blog.rust-lang.org/2026/11/12/Rust-1.100.0/).
SolverForge v0.31.2, released 2026-11-17, is the current published native core
(https://solverforge.org/docs/status-and-roadmap/).
Its exact reviewed upstream revision 78889c3ff9fda158c70e6a1f67f8c7f0fdae922e
declares workspace edition 2021 and MSRV 1.95, and its own rust-toolchain.toml
pins Rust 1.99.1. The local candidate declares rust-version 1.99.1; upstream
MSRV is not proof that the full candidate supports 1.95.

Add an independent native ARM64/musl CI matrix for **both exact compiler
pins: 1.99.1 and 1.100.0**. Each leg checks the real compiler release,
runs the complete Rust/Python tests, strict Clippy and warnings-as-errors
release build, static ELF checks, unchanged Cargo.lock verification and
the original OSV inventory/audit; retain public per-toolchain evidence.
Disable matrix fail-fast so failure on either leg cannot hide the other.
Retain the existing 1.99.1 check name and original long comparison compiler,
immutable controls and resource gates. The 1.100.0 leg is an actual
qualification, not a declaration of measured compatibility or a performance
improvement. Promotion of the latest stable to the canonical benchmark
requires successful compilation/tests/lint/security checks followed by
the same independent comparison and tail/quality gates.

The 2021 edition remains deliberate: upgrading the compiler alone does not
make edition-2024-only syntax legal. No blanket cargo update, no toolchain
alias, no upstream fork, no added dependency, no lockfile or MSRV change.
The lock includes 102 packages (87 crates.io records, 15 workspace
records); native core family 0.31.2, serde 1.0.228, serde_json 1.0.149,
thiserror 2.0.18, toml 1.1.2+spec-1.1.0, rand 0.10.1, rayon 1.12.0,
smallvec 1.15.1, tokio 1.54.1 and the reviewed anyhow 1.0.103 correction.
The lock inventory is not a claim that every crate is reachable by the
candidate. OSV scope is the resolved graph and registry lock, not
compiler/stdlib/musl or production certification. Update a dependency only
with a concrete security/compatibility justification and review of the
resulting locked graph. Existing SF58–SF60 qualification remains pending;
do not infer a successful new compiler run before actual CI evidence.
