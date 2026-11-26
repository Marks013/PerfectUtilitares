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
