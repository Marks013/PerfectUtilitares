# Auditoria incremental do candidato SolverForge E2-SF1

Escopo: PR #75, revisão de partida 811ec15dc7aea682c200d068cdf0ac5b884f99e3; OR-Tools f78c691edbeaf16283f534bcacd8db1b4b7d5e66, Timefold E2.5 71945cd6e73c48b424dab1297fbc3bf8a15ae585. Nenhuma alteração de main, servidor, PostgreSQL, Compose produtivo ou PR #74.

## Achados e intervenções

| ID | Evidência/risco | Intervenção | Estado |
| --- | --- | --- | --- |
| SF01 | [CI 45739664460](https://github.com/Marks013/PerfectUtilitares/actions/runs/45739664460): E0277 em penalize com score local; demais erros anteriores não reapareceram | Usar fixed_weight da API pública para peso constante; manter adapter de nove níveis | CI pendente |
| SF02 | model.rs acumulava enumeração, agregação, validação e construção | Separar patterns, coverage e seed mantendo corpos funcionais e fachada | Equivalência textual; compilação pendente |
| SF03 | Mapper podia ignorar monthlyCarry, carriedHolidayRest, ausência manual, origem de calendário e liderança manual | Recusar explicitamente metadados não modelados e IDs duplicados de demanda; verificar deadline por banda | Testes negativos adicionados; CI pendente |
| SF04 | p50 de seis amostras usava nearest-rank inferior; medianas independentes não são deltas pareados | Mediana verdadeira, máximo (sem p95), deltas e redução por par válido, zero baseline sem porcentagem | Testes Python adicionados; CI pendente |
| SF05 | OSV consultou 52 dependências alcançáveis sem match em 45739664460, mas não cobre stdlib, musl, compilador; RustSec histórico anyhow 1.0.102 no lock total | Manter gate e achado, auditar grafo e cadeia de build antes de adoção | Aberto |
| SF06 | Domínio pessoal com até 50.625 padrões brutos em 4 semanas; clone de ranges por pessoa e recomputação do setor por movimento | Medir custo real de mapeamento, seed e busca antes de alterar representação/cache. Não extrapolar para 6 semanas | Aberto |
| SF07 | Modelo parcial não cobre 16 objetivos, ausências, dezembro, relógios variáveis, liderança completa, histórico/futuro e demais modos | Recusar escopos não suportados e manter validador original. Expandir somente depois do smoke e da qualidade E2 | Aberto |
| SF08 | Seed-only executado depois dos três motores; tempo sofre possível efeito da ordem | Diagnóstico separado, não atribuir ganho causal amplo; futura ablação balanceada com mesma seed, orçamentos 2/4/8/12 s e holdouts | Aberto |

## Sequência de aceitação

1. Cargo locked/offline e testes de integração do solver nativo, incluindo score recomputado.
2. Smoke ARM64 com três motores e imagem estática verificada, sem acesso a rede durante solve.
3. Seis ordens dos três motores nos três casos E2, com métricas de cobertura por setor, veto de proteção, CPU, latência e memória; pares inválidos não contam como ganho.
4. Comparar construtor com busca real, corrigir somente gargalos medidos, sem alargar CPU/RAM. Depois portar regras E3 e executar holdouts E4 com amostra suficiente.
5. Avaliação de segurança e operação separadas. Nenhum merge ou deploy; nenhuma certificação de superioridade neste recorte.

A medição usa o mesmo 1 CPU/1536 MiB/64 PIDs e prazos 12/18/20 s. A referência do produto, o verificador independente e os SHAs de controle permanecem congelados. Resultados sem paridade completa não justificam troca.

## Revisão consolidada SF09–SF15

Base de revisão 36e389d4bdbf921393e7248cab88420508cb329c. O workflow 45741108949 passou pela compilação e pelos testes nativos antes desta revisão, sem certificação de benchmark nesta consulta.

| ID | Mudança | Prova exigida |
| --- | --- | --- |
| SF09 | Arc de domínios por perfil; poda de prefixo com legal() final e índices originais | Igualdade exaustiva, locks, cap e prazo |
| SF10 | Collector reversível com bandas indexadas por dia, attendance, custos pessoais e contadores dominicais | Comparação de cada estado com group_cost original e fast_assert nativo |
| SF11 | Diagnóstico isolado seed-only / 2 / 4 / 8 / 12 s em cinco rotações | 25 registros, identidade, quotas, scores externos, prazos e fracassos explícitos |
| SF12 | Inventário de todo lock registry e escopo alcançável, histórico anyhow retido | Consulta OSV e identificação de achados; compilador/stdlib/musl ainda pendentes |
| SF13 | Benchmark principal e controles congelados, nenhum p95 com seis amostras | Três motores, 6 ordens, validação real e deltas pareados |
| SF14 | Segurança de modelo parcial, sem inferir cobertura de E3/E4 | Continuar recusando dezembro, histórico, outros modos e horizontes fora de E2 |
| SF15 | Plano de ampliação sem produto cartesiano de seis semanas | Projetar DP/transições por semana com estado de descanso e domingo, bitsets/arrays escaláveis, paridade dos 16 objetivos e holdouts antes de aceitar |

Não considerar os ganhos de CPU/memória comprovados até comparar o SHA anterior e o novo em condições equivalentes. A curva é diagnóstica somente do Rust, não demonstra causalidade universal nem comparação de orçamentos curtos com OR-Tools/Timefold. A execução completa no ambiente ARM64 é obrigatória; nenhum novo teste Rust foi executado localmente. Nenhum deploy, merge, mudança de quotas ou alteração dos controles.

## SF16–SF17 — segurança e gate operacional

Evidência: 45741511691, 52 crates alcançáveis sem avisos, um aviso em 87 crates registry. Anyhow 1.0.102 fora do grafo candidato, mas presente no lock. Atualização exclusiva para 1.0.103, [RustSec](https://github.com/RustSec/advisory-db/blob/main/crates/anyhow/RUSTSEC-2026-0190.md), [índice registry](https://raw.githubusercontent.com/rust-lang/crates.io-index/master/an/yh/anyhow), checksum 2a4385e2e34eb35d6b3efe798b9eb88096925d87726c0798709bf56d9ed84af3. Verificação reversível do lock upstream, fetch locked, testes offline e auditoria OSV sem waiver. Rustc/stdlib/musl/notices continuam pendentes.

O benchmark anterior produziu 18 propostas válidas por motor, mas SolverForge 50/28 apresentou 6/6 regressões dominicais contra cada controle. O novo gate exige zero regressões e retenções em todos os pares E2; exploração e diagnóstico continuam separados. Não é certificação de E3, produção ou superioridade geral.

## SF18–SF20 — reparo dominical e configuração

Coortes de equilíbrio por setor, cargo, geometria de relógio e limite dominical, dentro de 42h e relógio fixo; cálculo integral independente e acumulador incremental continuam separados. Reparo opcional limitado a 20 mil estados/250 mil transições por coorte e prazo existente: projeta domínios legais em contagens de domingos, reconstrói padrões e só aceita redução dominical sem piorar hard, total, pico e presença diária do setor. Não importa incumbentes dos outros motores. Testes de projeção conjunta, prazo, coortes e limites civis. O validador TS permanece obrigatório, inclusive função/faixa, fechamento e qualidade de descanso. E3/E4 continuam pendentes: 40/44h, misto, feriados, ausências, histórico/futuro, relógios variáveis, modos REST_ONLY/HOURS_ONLY, dezembro, 115/250 e proteções privadas. Não reduzir obrigações para obter resultado. A melhora ainda depende de CI e novo benchmark ARM64.

## SF21–SF24 — compatibilidade Java e higiene

- E2-WIRE-1: 26 casos idênticos ao Timefold 7c426f887a3a1424e01d2a3e877bad196e34ecad, validados por comparação byte a byte e testes nativos. Corrigir divergências de admissibilidade dentro do recorte E2, não expandir modelo em silêncio.
- Remover override Cargo default-features ignorado (upstream default=[]), export de legal só em testes e campo Member.sunday_cap redundante; Clippy com lints específicos obrigatórios e rustc -D warnings no candidato, não nas dependências. Rustfmt e lint completo ainda pendentes.
- Verificar deadline durante construção de assinaturas dominicais, sem mudar domínio ou quotas.
- Node24 no upload de artefatos da CI comum, mesmo SHA dos experimentos. Não suprimir depreciações. As revisões permanecem independentes e a comparação Timefold E2.5/CP-SAT permanece congelada. E3/E4 e homologação pendentes; nenhum JNI, mudança de produção, dados ou merge.

## SF25–SF28 — estratégia Rust independente

- Terminação por estagnação nativa e seleção conservadora do incumbente em modo adaptativo separado; validação individual e score recomputado, sem ocultar falha nativa.
- Métricas distinguem busca realizada, custo da busca e solução devolvida; comparação pareada com construtor e busca integral, contagens de regressão e retenção. Seis variantes/seis posições. Não inferir ganhos de latência a partir de validações incompletas.
- Corpus comum fixado por blob (6f0f97b8aaadfe1c94034937ff4f134fb4f388a5); elimina dependência de ref viva do Java. Nenhuma JNI ou runtime JVM no Rust.
- CI anterior do Timefold 7c426f8: 41 testes Java e correção glibc comprovada; a execução Rust com lock corrigido passou build na revisão 68ff69f, auditoria integral do candidato final ainda depende da nova CI. E3/E4, auditoria toolchain/musl/notices e homologação permanecem não certificados. Não aumentar quotas nem alterar produção.

## SF29–SF31 — cobertura conjunta e atribuição

Base 7f16fc8. O benchmark 45745537714 demonstrou 2016 pessoas-minutos de desfalque dominical, em quatro setores, apesar de 26208 totais e CPU muito baixa no construtor. A projeção anterior por coorte podia ficar presa quando o encarregado consumia domingos incompatíveis com a capacidade dos repositores. Novo beam limitado a 16 estados por estágio, 300 mil avaliações por setor, seis distribuições e duas ordens de reconstrução, permitindo mudanças conjuntas entre coortes. Mantém legal(), locks, demanda confirmada, teto de total/pico, presença e proteção de cada faixa dominical e déficit de função acumulado. O guard adaptativo também verifica cada piso de função, não só o máximo agregado. Telemetria registra setores tentados/aceitos, projeções, reconstruções, prazos e limites; não confunde com moves nativos. Teste de duas coortes com quatro domingos e mutações de evidência de retenção. Sem prova de zero regressões até a execução ARM64. Não altera controles, quotas ou validador TS.

## SF32 — capacidade de presença e redução de custo da reconstrução

Presença agora usa bitmap de quatro palavras (256 posições), com testes de 250 pessoas, fronteiras 63/64/127/128/191/192 e piso por função, em todos os caminhos de pontuação/reparo. A entrada ainda recusa >50: isso é fundação de capacidade, não benchmark E4. Cache de índices por assinatura dominical/perfil evita varrer todo o domínio a cada reconstrução, e tabela de ganhos semanais substitui 28 iterações por candidato; mesma ordenação de objetivos e nenhuma exclusão de padrões legais. Beam deduplica testemunhas idênticas. Medição ARM64 obrigatória para avaliar eventual custo extra do bitmap.

## SF33–SF36 — domínio compacto, testes de escala e métricas de cauda

- Autômato semanal com estado de cauda WORK/OFF, sequência dominical, interseção de folgas variáveis e locks absolutos. Domínios E2 agora usam contagem/enumeração de caminhos com o predicado legal() independente e IDs originais. Teste diferencial exaustivo 7/28d; contagem DP 42d, sem gerar 11.390.625 candidatos brutos: cap1=587620, cap2=1854611, para perfil sem locks. Contagens verificadas adicionalmente por implementação independente JS de estados. Não representa ainda calendário/horários E3.
- Bitmap e acumulador exercitados com 115 e 250 pessoas em teste de componente; não habilitar o mapper para 250 nem anunciar benchmark integral. Teste de déficit de função ocultado por total.
- Tail E2 pré-registrado: 32 repetições rotativas para CP-SAT, controle Timefold, Rust native-12 e adaptive; P50/P95/máximo, CPU, RAM, validade e comparações de qualidade. P95 só com 32 válidas; nova etapa condicionada a qualidade E2 e OSV aprovados. Timeout CI 75min, sem alteração dos limites de solução/contêiner. Sem certificar p95 em produção ou concorrência.
- Ainda não implementado: novos tipos de variável e domínio para 40/44h/misto, calendário civil/feriados/ausências, histórico, modos, proteções de referência e 16 objetivos, integração nativa de hooks candidate_values/nearby para novos domínios, HTTP/cancelamento, inventário integral rustc/std/musl, notices, rustfmt e capacidade A1. Manter todos os vetos; nenhum benchmark menor substitui E3/E4. CI nativa pendente neste SHA.

## SF37–SF40 — E3a parâmetros pessoais

Portar fixed_rest_projection e o recorte sem histórico de _streaks/_rest/CONSECUTIVE do OR-Tools f78c691. Validar 40/42/44h, duração exata do relógio selecionado, limites, modalidade e projeção de slots. Preferências e estabilidade recebem níveis distintos (vetor 11), sem tornar preferência hard. Regras de folga variável e rodízio consideram isenções FIXED/CONSECUTIVE, e espaçamento só VARIABLE/ANY. Domínios cacheados por configuração. Testes nativos de perfis e diferencial dos estados. Preservar recusa de semântica ausente; não alegar E3/E4 completo. Nova compilação e ensaios externos necessários.

Corpus E3A-FIXED-CLOCK-1 compartilhado por blob 2972584ac91979b65bb7782aa8374fcbb86f7b90, com três jornadas simultâneas, folga mista/fixa/variável, preferência e referência importada selecionada. Seis mutações negativas. Não é evidência de paridade de todos os casos do OR-Tools; comparar via cliente congelado e avançar o modelo temporal para as famílias ausentes.

## SF41–SF44: descanso operacional e prova de ganho adaptativo

Evidência da revisão 2c81c75 (45746863995): 18/18 válidas; 0 regressões contra OR-Tools e Timefold; no cenário 50/28, seis retenções exclusivamente REST_DISTRIBUTION (1 par ajustável vs 0). Desfalque dominical zero nas seis amostras; 26208 pessoas-minutos, latência 11,399s, memória 4997120 bytes. Construtor 0,385s, score igual ao nativo. Implementado reparo determinístico por trocas de dias úteis e pares de coorte, score de descanso quatro níveis exatamente como TS no recorte admitido, grupos reais de descanso/fairness e validação independente do vetor no relatório. Nenhuma transferência de deficiência por função ou faixa durante o reparo. Gate separado de ganho adaptativo pré-registra 32 pares completos, não inferioridade contra CP-SAT, Timefold e native-12, >=25% de ganho mediano pareado e P95, CPU não maior. Não afirmar que o ganho ocorreu antes de CI. O benchmark de cauda pode gerar evidência diagnóstica mesmo se a etapa de não inferioridade E2 reprovar; permanece impossível declarar homologação integral. Preservados E3a e os demais limites sintéticos; horários variáveis, jornada mista, histórico/futuro, feriados/ausências, calendários, modos completos e todos os 16 objetivos continuam requerendo modelo temporal E3b/E3c. Sem alterações em produção.

## SF45: três modos no recorte de referência fixa

HOURS_ONLY grade completa, singleton legal preserva dias e flags; relógio conhecido anterior pode mudar apenas no WORK desbloqueado. REST_ONLY primeira referência da mesma duração, como solver.py. Testes de troca de 40/42h com dias intactos, conflito de lock e falta de grade. Evitar cache de projeções cruzar domínios unitários distintos. O modo ainda não oferece escolha de horários diferentes por dia ou exceções de calendário e não constitui paridade geral.

## SF46: qualificação diferencial dos parâmetros pessoais

27 medições (três modos, três variantes CP-SAT/native/adaptive, três rotações), usando corpus E3A-FIXED-CLOCK-1, schema e cliente original com 40/42/44h simultâneas e demanda confirmada por dia. HOURS_ONLY parte de grade com referência de relógio editável incompatível, mas preserva dias/locks e corrige apenas o relógio. O modo adaptive retorna incumbente completo sem busca quando todos os domínios são unitários, com telemetria SEED_RETAINED. Teste de identidade, validade/atribuição, comparador real, telemetria e gate independente no escopo. Controle Java histórico não suporta E3a: não incluí-lo neste ensaio, manter comparação tripla E2 separada. Timeout de workflow 90 minutos para as amostras adicionais; prazos de solução e quotas intactos. Gate de ganho adaptativo falha se resultado não prova 25% de redução pareada e P95, sem regressões. Não certifica paridade de regras não implementadas.


## SF47–SF51 — peak repair and bounded adaptive rounds (pending ARM64 evidence)

- The former summed sector-peak objective can conceal different per-sector distributions. No Timefold/OR-Tools assignments, peak targets, or output-specific constants are used. After existing Sunday/rest repair, a bounded sector-local pass transfers weekday work within a legal weekly pattern, preserving Sunday, pinned patterns, individual rest/preference/reference metrics, daily presence, confirmed demand and exact clock/role deficit sums and maxima. The squared-gap potential may improve a plateau but cannot raise a sector peak. Unmatched civil intervals cannot acquire a deficit. Up to four passes / 100000 tested swaps under the existing constructor deadline; the score vector, controls and quotas are unchanged. This is a conservative local search, not an optimality proof.
- Native v0.31.2's unimproved-time criterion lacks an in-phase limit installation (termination/unimproved.rs and solver/session.rs). For valid seeds, use actual solver-wide caps of at most 2 seconds per round, continue only for a strict score gain protected by the incumbent guard, restore on ties/regressions. Incomplete seeds retain the full rescue budget; pinned complete seeds skip native search. Separate round telemetry, accepted/last native costs and reason, no claim of native stagnation activation.
- Independent evidence verifier checks round caps, monotonic accepted costs, rollback/source attribution and peak repair counters; tests for redistributed deficit, role/time veto and guarded native rounds. E2 gates, 32-repeat tail, 25% paired/P95 requirements and E3a corpus remain unchanged. No compile, runtime, or benchmark result claimed before ARM64 CI; Clippy style cleanup, full E3/E4 and upstream in-phase termination fix remain separate tasks.


## SF52 — correct the synthetic fixture and remove known Clippy warnings

ARM64 run 45801486493 compiled and ran 37 Rust tests (36 passed, 1 failed). The sector integration fixture used "Synthetic {n}" instead of the enforced "Synthetic person {n}" prefix, so the wire mapper rejected it with SYNTHETIC_ID before the repair ran. Correct only the test data; the admission guard and assertions remain intact. The two direct peak tests and bounded adaptive integration test passed; 13 evidence tests and OSV passed (52 reachable / 87 locked crates, no advisories in that scope). Release build and all benchmarks were skipped.

Resolve the 16 historical Clippy warnings from run 45751363810: negative assignment formatting, attendance/weekly iteration, domain lock argument grouping, modulo predicates, nested condition, and cache entry handling. Also fix the new peak-repair polling predicate. These changes preserve iteration order, deadlines, legal-domain checks and cache keys. Keep the existing build checks; require candidate-only Clippy with -D warnings in a separate step after measurements to retain independent evidence even if a new style warning appears. No warning suppression, rule changes, control changes, or production modifications. Fresh ARM64 build, 37 tests, lint, quality gates, and 128-execution benchmark remain required; no gain or E3/E4 completion claimed here.


## SF54a — six-week fixed-clock scale expansion (not E3/E4 certification)

Preserve the passing 79bca2c E2 controls and gates. Widen civil masks/attendance to 42 days, keep 7/28-day exact catalogue, admit the frozen Nov 1–Dec 12 six-week synthetic horizon and up to 250 timed employees. Use exact suffix counts with deterministic rank-stratified selection of at most 2048 legal paths per profile (plus a legal supplied seed if necessary); do not materialize 15^6 raw masks or claim full-domain search. Shared Arc catalogues, 6-week Sunday repair and full/incremental score agree; keep all deadline and lock checks. Exact count and selected count are separately reported. A bounded neighborhood can omit useful paths; no optimality claim. Six-week diagnostic separately compares frozen OR-Tools against Rust native/adaptive, three balanced rounds per 115/42 and 250/42, actual client and unchanged independent evaluator. No historical Java comparison on its unsupported domain, no P95 claim. A validity failure rejects this step; noninferiority is reported separately and is required before E4. New Rust scale and sample tests, Python missing-evidence test; ARM64/strict lint/benchmarks still pending. Variable clocks, mixed 42h, civil exceptions, history and all original objectives require separate temporal model work.



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

SF54f follow-up: frozen core only emits both coverageAudit and restAudit for 7/28 days. On 42-day accepted engine-new proposals require supplementary scaleCoverageAudit and scaleRestAudit from the unchanged TS product coverage/rest evaluators; native fixed-clock rest costs still cross-check the independent metrics. No synthetic zero or bypass of the existing validity/attribution gates.


## SF55–SF57 — correction of the first complete combined-model attempt

Evidence from PR head cb97d22, run 45814929660: 48 Rust tests, 16 Python tests, fixed-clock E2 noninferiority and adaptive gain passed. E2 native/adaptive p95 11.409/2.403s (78.94% reduction). Fixed 115/42 and 250/42: all 18 proposals valid, but every candidate/control pair vetoed by SUNDAY sector coverage (worst observed 0 -> 1008 person-minutes). Native/adaptive equal cost; previous repair discarded 7/17 sector frontiers at the exact projection limit. Adaptive median product latency 2.842/3.642s; estimated shortage 102312/221256 vs OR-Tools 151200/411264. The scale gate was validity only, not noninferiority. Mixed-variable temporal case emitted 4 valid paired observations, both candidate pairs vetoed by role-time service (900 -> 360 person-minutes in one horizon interval); remaining cases were not executed. The fixture put paid holidays on inadmissible dates (November 3 and 20); product schema only admits January 1, May 1 and December 25. Six Clippy chunks_exact_to_as_chunks diagnostics blocked strict lint; no warnings suppressed.

- SF55: use Rust 1.99 as_chunks for six actual lints; civil ordinal calendar for complete Sunday weeks in 2026 before Dec 16, no padded inferred monthly horizon; admit paid holidays only from original product calendar. Weekly holiday case Apr 26–May 2 and combined cases Apr 5–May 16 use May 1 with genuine history and locks. New calendar test rejects the former inadmissible dates and unported transition/padding. Preserve November E2 fixtures. Supplement original evaluator vectors at non-November temporal horizons; when core provides them cross-check byte-for-value agreement. Log case/stage and sanitized schema issues; continue independent cases, fail overall on incomplete evidence.
- SF56: use bounded beam over actual legal Sunday signatures for six weeks only, retaining original count frontier for 7/28. Two sweeps and bounded projected evaluations; do not reduce individual Sunday work counts. Reconstruct within legal domains and retain the original hard/coverage/presence/role/peak acceptance. Unit case 12 same-role employees, six Sundays, requires zero Sunday deficit from a deliberately concentrated roster. This is not evidence of the 115/250 quality gate until CI measures it.
- SF57: seed ranks hard/estimated demand first, then fills empty timed days and prefers actual Sunday service/dispersion; no new demand or invented credited DUTY hours. Temporal native result must improve strictly while preserving valid incumbent sector prefix, high-priority local leadership, timed daily presence, actual role-time service and per-band role deficits/peaks across horizon/Sundays. Recompute before/after with common clock/demand boundaries; decline a lost interval and restore incumbent. Added native acceptance/source telemetry and independently validated evidence; a rejected native move is not native improvement. Unit guard test changes a legal 8h clock without changing total hours and must detect service loss. These conservative guards can restrict improvements; not equivalence to all original phase guards.
- Execute scale/temporal diagnostics early after audit and control builds; existing E2, tail, personal, security, quotas, evaluator, lockfile and controls unchanged. Require separate expanded noninferiority gate after diagnostics, even if validity succeeds. Remaining: obtain measurements from all six temporal fixtures and new scale runs, resolve any regression; still no full E3/E4, overnight, partial employment, monthly transition/cutover, private protection or production certification.
