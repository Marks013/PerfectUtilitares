# SolverForge — contratos de cobertura recuperados; main bloqueada

Atualização: 27/11/2026. Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base: `2d547d092f67289354c9f5bd22bec7c71ed40724`.
Árvore de código efetivamente compilada e verificada: `d10941c086ca1f425d8a6282fe4924f9831708ca`.

## Escopo e limites preservados

O runtime continua exclusivamente SolverForge, com Python para autenticação, transporte, validação e supervisão. OR-Tools permanece somente como controle histórico externo do benchmark. Rust 1.100.0, upstream fixado, dependências e Cargo.lock não foram alterados. O componente rustfmt da mesma versão foi instalado apenas no laboratório e aplicado somente ao novo módulo de testes.

Foram alterados seis arquivos de código/testes/inventário e este relatório. O comparador externo, os cenários, as asserções públicas anteriores de qualidade e os workflows permanentes de qualificação permanecem iguais à base. Não houve merge, deploy, build Docker nem alteração na main, Timefold #74 ou branch original do PR #75. O workflow temporário usado exclusivamente para transportar objetos Git com hash verificado é removido da árvore final; seu sucesso não representa qualificação.

## Dois defeitos reproduzidos e corrigidos

### Déficit de referência fechada não pode desaparecer dos limites privados

A leitura descartava a estimativa de uma data fechada/feriado pago antes de compilar `_coverageComparison`. Isso permitia aceitar uma escala sem contabilizar o déficit constante que o limite privado exigia preservar. A fonte histórica `5732c4e21d793a0e22149907cd3e78e563a1ed05`, em `_coverage`, mantém essas referências quando há comparação privada.

Agora, a referência permanece no cálculo quando `_coverageComparison` está presente. Sem essa comparação, a exclusão preexistente das estimativas de feriados pagos e dos domingos fechados configurados continua preservada. Nenhuma data é reaberta, nenhum limite é ampliado e nenhum turno é inventado.

A regressão nativa e a chamada HTTP real mostraram a falha antes da correção. Depois, um déficit fechado de 60 minutos-pessoa com margem de fechamento zero é rejeitado; com margem explicitamente fornecida de 60, a proposta é aceita e informa os 60 reais em COVERAGE e CLOSING_COVERAGE. O contrato de uma data técnica fora do mês visível também verifica que a data continua no horizonte e no fechamento, sem ser acrescentada ao total mensal.

### Cargo vazio em demanda geral

A demanda pública com `role: ""` era convertida em uma exigência para um cargo vazio, causando uma prova incorreta de falta de capacidade quando o contrato histórico a trata como demanda geral. A leitura pública agora conserva esse significado. Metadados dos colaboradores não são reescritos; nomes de cargos não vazios continuam exatos.

Essa correção não generaliza o campo de cargo dos limites privados de serviço. Um cargo efetivamente registrado como vazio continua sendo uma chave específica nesses limites. Há testes separados para a demanda geral e para essa proteção privada. O caso de sucesso foi executado por HTTP autenticado real, preservando a entrada.

## Portabilidade com rastreabilidade

Foram reabertas as fontes históricas exatas e portados 18 contratos do inventário:

- Seis de cálculo diário: deduplicação, sobreposição, máximos por cargo, déficit de função não compensado por excedente de outra, separação de confirmado/estimado e obrigatoriedade por cargo.
- Quatro de presença: WORK real não substituído por DUTY, ausência de piso inventado a partir de DUTY, preservação de presença diante de alvo zero e compatibilidade com afastamento/folga bloqueada.
- Oito de proteção/comparação: cobertura do setor de origem e de domingo na primeira construção, redistribuição de déficit entre domingos, limites setoriais e dominicais, pico simultâneo, divisão por cortes de horário, margem implícita zero por cargo, fechamento fora do mês e contagem única da pessoa na passagem entre datas.

Cada registro mantém sua identidade histórica, revisão de origem, SHA-256 do corpo original, justificativa da portabilidade, destino Rust, nome qualificado do teste e SHA-256 do arquivo de destino. A baixa só foi aplicada depois de verificar esses nomes na execução nativa completa aprovada. Os 481 identificadores históricos foram preservados; 337 continuam pendentes. `readyForMain` permanece false.

Os contratos originalmente isolados de cobertura continuam testes de componente: usam o decodificador, o cálculo integral e as proteções reais do SolverForge com atribuições controladas, assim como os modelos CP antigos isolavam essa álgebra. Eles não são apresentados como escalas semanais completas legalmente válidas. Os testes de primeira construção e os testes HTTP exercitam também o fluxo completo. Não foram recriados CpModel, variáveis CP ou auxiliares falsos apenas para satisfazer mocks.

Algumas verificações adicionais têm escopo parcial e não receberam baixa no inventário: por exemplo, a preservação numérica dos domingos mensais não é apresentada como substituição integral do diagnóstico textual histórico, nem a aceitação de candidatos pela proteção como prova de equivalência de toda a busca antiga. A contagem das pendências não foi reduzida por esses casos.

A verificação do inventário agora admite destinos Rust explicitamente registrados, mantendo a exigência de zero pendências para release. Ela rejeita arquivos cujo hash mudou, funções ausentes, testes ignorados ou condicionais, módulos desabilitados, caminhos externos e identidades incompatíveis. Esses testes estruturais não substituem a execução obrigatória do cargo test na CI.

## Validação executada

Ambiente isolado Linux x86_64/GNU, Rust 1.100.0. As fontes foram comparadas byte a byte com a cópia compilada e os seis blobs de publicação foram conferidos por hash.

| Verificação | Base 2d547d0 | Candidato desta rodada |
|---|---:|---:|
| Testes Rust completos aprovados | 136 | 162 |
| Testes Python do experimento aprovados | 45 | 45 |
| Testes de transporte, fases, HTTP, presença e ocupação civil | 69 | 71 |
| Testes da suíte pública completa | 250 | 257 |
| Falhas da suíte pública | 1 | 1 |
| Erros da suíte pública | 0 | 0 |
| Testes ignorados da suíte pública | 0 | 0 |
| Contratos históricos pendentes | 355 | 337 |

Clippy all-targets com -D warnings, build release, Ruff, conferência do Cargo.lock e git diff --check passaram. Foram acrescentados 26 testes Rust e sete testes Python, incluindo dois caminhos HTTP reais e cinco verificações de integridade dos destinos nativos. Os 71 testes de fronteira fazem parte da suíte maior, não são cobertura adicional independente.

Uma verificação nativa adicional confrontou a cobertura e o fechamento com um cálculo independente minuto a minuto em 256 combinações de demanda, duplicação, ordem de entrada e equipes. Os valores coincidiram. Não é benchmark nem demonstração de ótimo global.

A suíte pública sem filtro terminou com 257 testes, uma falha, zero erros e zero ignorados, em 259,049 segundos. A única falha é `test_every_retired_test_has_a_reviewed_migration_disposition`, por 337 contratos ainda pendentes. O código de saída permanece 1. Não há aprovação integral para main.

## Pendências de homologação

Continuam necessárias a portabilidade ou revisão explícita dos 337 contratos, a não inferioridade ampliada por cargo/faixa, vigência parcial, dezembro e domingos, ARM64/musl do novo commit, contêiner/segurança/E2E e as 32 repetições de desempenho e estabilidade. A equivalência integral dos objetivos e dos contratos temporais ainda não está certificada. Hora noturna reduzida e outros limites já documentados não são declarados implementados por esta rodada.

O benchmark ampliado e a medição de estabilidade não foram executados neste candidato. Não houve revisão por subagente autônomo. As verificações de álgebra, os testes negativos, a conferência das fontes históricas e a revisão do diff não são apresentadas como revisão independente nem como ganho geral de desempenho.

## Evidências e retomada

Laboratório: `/vercel/lab/contracts-round7`. Workspace: `/vercel/solverforge-round7`, baseado em `2d547d0`; retomar o próximo bloco em uma worktree limpa do commit publicado. SHA-256 dos logs finais:

- Rust: `2b0a4c7b24c8a77c5aecc1411bc7da261e3638e843130926c5940e94b1f5c9f0`.
- Clippy: `59c151386e03247033ff283b096b54e8da17fe39927caa2ee70b0152bb6c7ca2`.
- Build: `c3ca109861d7426819db9e118e38eefd785f84203eecdca51f6fd4921d74f3b7`.
- Fronteiras: `096c3d062bd968ad56ab48be55c9fc3de5e6e3d37ca90ea97c6f0302e40fc101`.
- Suíte pública: `26a8952c4adcf9bb49146b30c1ffebbe59e3aea85c164fa0c5beb1e0c03cb322`.

O checkpoint publicado preserva os resultados, a árvore verificada, os hashes e as pendências; não autoriza merge ou deploy.
