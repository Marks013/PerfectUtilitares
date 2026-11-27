# SolverForge — sugestões iniciais e catálogos corrigidos; main bloqueada

Atualização: 27/11/2026. Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base: `f422cf3ff51cfdfb2827cc904a4e7d5e88d7b05c`.
Árvore de código compilada e verificada: `3b33cad1eee52b5de05dad55432158ceff996baa`.

## Escopo preservado

O runtime continua exclusivamente SolverForge, com Python para transporte, autenticação, validação e supervisão. OR-Tools permanece somente como controle histórico externo. Rust 1.100.0, upstream, dependências e Cargo.lock não foram alterados. Foram alterados cinco arquivos de código/testes/inventário e este relatório.

Não houve alteração da main, Timefold #74, branch original do PR #75 ou produção, nem merge, deploy ou build Docker. Comparador externo, cenários, prazos, limites dos domínios, workflows permanentes de qualificação, esquema HTTP e asserções públicas anteriores foram preservados. O workflow temporário de transporte de objetos Git verificados por hash é removido da árvore final; seu sucesso não qualifica o motor.

## Correções e otimização

### Sugestões opcionais não podem invalidar a solicitação original

Foram reproduzidas rejeições nativas por sugestão duplicada e referência de turno desconhecida. Pelo HTTP autenticado, uma sugestão duplicada ou com data fora do horizonte produzia 422 apesar de a solicitação autoritativa ser viável. A nova leitura interna descarta integralmente uma sugestão inutilizável e continua a partir das atribuições e regras originais. Não aproveita silenciosamente apenas parte da sugestão.

A fonte histórica `5732c4e21d793a0e22149907cd3e78e563a1ed05` distingue a validação pública de `model_input` da avaliação interna de `_initial_hint_baseline`. Essa distinção permanece: formatos e referências inválidos continuam rejeitados na fronteira HTTP; somente a sugestão opcional que chega à avaliação interna é descartada quando inutilizável. O esquema público não foi relaxado. O decodificador sintético continua estrito.

A leitura limita sugestões a 10.500 registros e verifica o prazo durante o percurso. MAPPING_TIMEOUT nunca é convertido em sugestão inválida ou ignorado. Uma sugestão não pode esconder erros nas atribuições obrigatórias, redefinir afastamentos, folgas fixas, feriados, bloqueios, vigência ou o modo HOURS_ONLY. As proteções privadas e a cobertura confirmada continuam obrigatórias.

Registros de colaboradores excluídos podem acompanhar a sugestão quando são exatamente os registros originais preservados. Não se tornam entidades de otimização nem fornecem cobertura. Alterar esses registros invalida a sugestão, sem alterar os registros reais. Essa diferença também foi reproduzida antes da correção e verificada por HTTP real.

### Rejeição global sem efeitos no catálogo

Uma sugestão pessoalmente legal, mas inviável para a cobertura global, podia ser acrescentada ao catálogo amostrado antes da verificação final. A rejeição limpava a escolha, mas deixava o catálogo modificado. O caso foi reproduzido em seis semanas com horários equivalentes e uma sugestão não presente na amostra.

Agora, os avaliadores reais de setor e globais verificam componentes temporários antes de copiar ou substituir qualquer entrada de catálogo. Uma sugestão rejeitada deixa intactos catálogo, alternativas permitidas, custos de desempate, seleção e flags de fixação. Uma sugestão globalmente viável continua disponível como escolha móvel. Não foram alterados os limites de amostragem ou a política existente de inclusão de sugestões aceitas no limite do catálogo.

Os objetivos de alteração continuam referidos à grade originalmente salva. No contrato de troca de dois dias, a construção mede PEOPLE_CHANGED=1 e STABILITY=2, sem transformar a sugestão em uma nova referência de custo zero. Não há fabricação de telemetria ou alegação de ótimo global.

### Reuso de catálogos equivalentes

Um teste adicional mostrou quatro cópias de um mesmo catálogo quando quatro pessoas com o mesmo domínio recebiam uma sugestão idêntica fora da amostra. A aplicação agora compartilha o catálogo imutável enriquecido e os índices permitidos para a combinação exata de domínio original e estados sugeridos.

Nesse teste, quatro catálogos distintos passaram a um compartilhado. Os custos individuais de desempate SHA continuam separados e conferidos contra o cálculo de cada pessoa. Sugestões diferentes usam famílias separadas, também verificadas. Isso reduz duplicação nessa operação; não é medição de RSS total, ganho geral de latência ou benchmark de escalas completas.

## Contratos históricos e rastreabilidade

Foram portados nove contratos: sete de sugestões iniciais e dois de preservação de feriados/afastamentos na geração. Cada registro mantém identidade histórica, revisão de origem, SHA-256 do corpo original, justificativa, destino Rust, nome qualificado do teste e hash do arquivo de destino. A baixa ocorreu após confirmar a execução nativa completa.

Os 481 identificadores históricos permanecem preservados. As pendências caíram de 337 para 328; readyForMain permanece false. Não houve descarte de contratos para liberar o teste. Uma omissão inicial do metadado de linguagem dos novos destinos foi detectada pela verificação existente e corrigida antes da publicação, sem modificar o verificador.

## Validação final executada

Laboratório isolado Linux x86_64/GNU, Rust 1.100.0. Fontes comparadas byte a byte com a cópia compilada. Novos testes: 17 Rust e quatro Python HTTP. As falhas de sugestão, mutação de catálogo e duplicação foram reproduzidas antes das respectivas correções.

| Verificação | Base f422cf3 | Código desta rodada |
|---|---:|---:|
| Testes Rust completos aprovados | 162 | 179 |
| Testes Python do experimento aprovados | 45 | 45 |
| Transporte, fases, HTTP, presença e ocupação civil | 71 | 75 |
| Testes na suíte pública completa | 257 | 261 |
| Falhas na suíte pública | 1 | 1 |
| Erros / testes ignorados na suíte pública | 0 / 0 | 0 / 0 |
| Contratos históricos pendentes | 337 | 328 |

Clippy all-targets com -D warnings, build release, Ruff, conferência do Cargo.lock e git diff --check passaram. Os 75 testes de fronteira integram a suíte pública maior; não são cobertura adicional independente. Os cinco testes direcionados de HTTP e integridade do inventário também passaram.

A suíte pública final, executada novamente após a otimização de compartilhamento, terminou com 261 testes em 264,673 segundos, uma falha, zero erros e zero ignorados. A única falha é `test_every_retired_test_has_a_reviewed_migration_disposition`, por 328 contratos ainda pendentes. O resultado permanece FAILED e o código de saída é 1. A ausência de outras falhas nos testes atuais não prova os contratos ainda ausentes.

## Pendências de homologação

Continuam necessárias a portabilidade ou revisão explícita dos 328 contratos, a não inferioridade ampliada por cargo/faixa, vigência parcial, dezembro e domingos, a qualificação ARM64/musl do novo commit, contêiner/segurança/E2E e as 32 repetições de desempenho e estabilidade. Esses benchmarks não foram executados nesta rodada. Hora noturna reduzida e a equivalência integral dos objetivos não são declaradas concluídas.

Não houve revisão por subagente autônomo; o Codex do laboratório continuava sem autenticação. A revisão do código, comparação com fontes históricas e os testes não são apresentados como revisão independente. Nenhum resultado desta rodada autoriza merge ou deploy.

## Evidências e retomada

Diretório: `/vercel/lab/contracts-round8`. Workspace: `/vercel/solverforge-round8`, baseado em f422cf3. Retomar o próximo bloco em uma worktree limpa do commit publicado, preservando os logs anteriores.

SHA-256 dos logs finais:

- Rust: `c737b0b55bd2d4318544f166e776bb1133809478c244d87c60267ee4ad0fa74b`.
- Clippy: `621be0b67e4e74ef1dcb3af691cc35d6da1bd9bedba3d928b1833d1049b26e03`.
- Build: `8785579081f54da207cb04c94b602bff6d0d42bffdd8043bf569ae715490e5f8`.
- Fronteiras: `2a6583ac765e4f77b73685b827286de08a685cfc1c1780174df9da43ce542995`.
- Suíte pública: `0496f0c5cc173e0fbf3a58294d3797cdaddbfe61bcd78622a37917bf5afaeb33`.
