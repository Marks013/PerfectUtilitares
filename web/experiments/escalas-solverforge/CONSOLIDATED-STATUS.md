# SolverForge: estado da branch consolidada

Atualização: 2026-11-26, horário de São Paulo.
Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base desta rodada: `22590a166d216d158f4ffaf8cc474043558d7ded`.

## Escopo e histórico preservado

A branch herda integralmente `ce0293f`, publicado no PR #75. A consolidação `22590a1` acrescentou a inicialização legal sem alterações de HOURS_ONLY e quatro testes, com 89 testes Rust e 45 Python aprovados no laboratório x86_64. Essa correção permanece intacta nesta rodada.

A continuação altera somente o reparo experimental de escala fixa e seus testes. Não modifica o cliente, comparador, cenários externos, critérios da CI, quotas de execução, dependências, Cargo.lock ou upstream. Não move a branch original do PR #75 e não faz merge ou deploy. Main, Timefold #74 e produção permanecem fora do escopo.

## Causa reproduzida e correção

Um colaborador com domingos nas semanas 1 e 4 não pode simplesmente ganhar outro domingo sob o limite de consecutividade. O reparo individual não consegue atravessar esse estado, mesmo quando dois colaboradores têm trajetórias legais complementares. O setor sintético de 12 pessoas reproduziu 504 minutos-pessoa de déficit residual com o domínio selecionado original preservado.

O novo módulo `src/model/seed/exact/paired.rs` organiza alternativas legais por assinatura dos seis domingos, mantém até 16 alternativas por assinatura e avalia trocas completas de duas pessoas da mesma coorte/grupo. A projeção dominical descarta combinações que perderiam cobertura antes da avaliação integral. Estados intermediários não são aceitos.

O reparo compartilha o prazo absoluto, o limite existente de 100.000 tentativas e o teto externo de 450 ms. Não aumenta o domínio nativo. Bloqueios, legalidade, datas atendidas, cobertura obrigatória, déficits por cargo/faixa, picos, excesso de folgas, alterações salvas e preferências continuam protegidos pelos predicados existentes.

A aceitação interna exige melhora dominical estrita e não piora dos cinco componentes operacionais. Ela deixa de congelar todos os desempates posteriores, acompanhando a ordem já usada pelo cliente original: melhoria operacional precede os desempates de distribuição. Isso não significa que os 13 custos nunca possam aumentar. Um teste específico documenta o trade-off de equidade; o teste do setor real melhorou sem aumentar nenhum dos 13 custos.

## Verificação executada

Ambiente: laboratório Vercel Linux x86_64/gnu, Rust 1.100.0 e upstream `78889c3ff9fda158c70e6a1f67f8c7f0fdae922e`. Não é qualificação ARM64/musl, Docker/cgroup ou do servidor de produção.

| Verificação | Resultado |
|---|---|
| Reprodução anterior do setor residual | Falhou: déficit 504, esperado zero |
| Setor após reparo conjunto | Déficit dominical 504 -> 0; déficit total 10.584 -> 10.080; pico 3 -> 2 |
| Testes Rust release completos | 91 aprovados, zero falhas, ignorados ou filtrados |
| Testes Python existentes | 45 aprovados |
| Clippy all-targets com `-D warnings` | Aprovado |
| Build release, comparação do lock e `git diff --check` | Aprovados |
| Reprodução local pelo cliente original | 16 propostas brutas/finais válidas e aceitas como novas pelo próprio fluxo |
| Comparação dessas propostas com o controle local | 11 aceitas sem regressão, 4 vetadas, 1 inconclusiva |

O último item não equivale a 16 comparações aprovadas. Nove cenários temporais e os dois fixos passaram na comparação local. Feriado/histórico, combinado 115, dezembro e vigência parcial continuaram vetados. O controle combinado 250 retornou UNKNOWN no laboratório, logo essa comparação não prova não inferioridade.

## Resultado nas escalas fixas completas

| Cenário | Déficit dominical anterior | Déficit dominical novo | Déficit estimado total anterior -> novo |
|---|---:|---:|---:|
| 115 pessoas, 42 dias | 1.512 | 504 | 98.784 -> 98.280 |
| 250 pessoas, 42 dias | 3.024 | 1.512 | 212.184 -> 211.680 |

Unidade: minutos-pessoa. São observações locais, não as 12 comparações ARM64. O comparador original aceitou ambos como melhoria operacional contra o controle local, mas esse controle já era inferior ao candidato anterior em certos pontos; a redução acima é a comparação direta entre os custos dos candidatos.

Os pares ajustáveis de folga nas escalas fixas passaram de 25 para 27 e de 57 para 61. A seleção original prioriza a melhoria operacional observada, mas esse trade-off permanece explícito; não há alegação de melhora de todos os objetivos. O déficit dominical ainda não foi zerado nas escalas completas.

## Experimentos rejeitados e pendências

Uma tentativa de priorizar disponibilidade exclusiva aumentou a presença temporal de 19 para 20 datas, mas deslocou a data descoberta e continuou reprovando no cliente. Foi revertida. Outra aumentou o trabalho no bloco parcial final de dezembro, mas criou um par de folgas ajustável; também foi revertida. Nenhuma dessas alterações temporais integra este commit.

Permanecem abertas as perdas por cargo/faixa em feriado/histórico e combinados, a presença diária com vigência parcial, a cobertura/distribuição de dezembro e os déficits dominicais residuais das escalas fixas. A comparação ampliada ARM64 e as 32 repetições de estabilidade/desempenho ainda não foram executadas para este código. Não há homologação integral ou autorização para substituir o OR-Tools.

## Identidade do código executado

Os arquivos publicados foram comparados byte a byte com o workspace compilado; os blobs Git são:

- `src/model/seed/exact.rs`: `1ae8d44b03106ebbfd37bfc3f656a64d54b67bf3`.
- `src/model/seed/exact/paired.rs`: `9f78cce1ee723ab4bed3aed595d8036d72058549`.
- `src/model/seed/exact/regression.rs`: `4a0a22ee9b85bc6a007e73b472c9ec57c986271e`.

A fixture compacta reconstrói os mesmos dados sintéticos e a mesma ordem de demandas do setor isolado. As máscaras são da construção do próprio candidato, nunca de uma solução importada do controle. Adaptadores temporários, protótipos rejeitados, binários e caches não foram adicionados ao repositório.
