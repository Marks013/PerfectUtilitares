# SolverForge — objetivos e fronteiras noturnas corrigidos; main bloqueada

Atualização: 27/11/2026. Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base: `d445f7f7f9a9c8208049ef0c8cd16f2fd3be0fc9`.
Árvore de código compilada e testada antes deste relatório: `55f754f067bdca5b7b9c22685de66aeaf0d84e08`.

## Escopo preservado

O runtime continua exclusivamente SolverForge, com Python para transporte, autenticação, validação e supervisão. O controle histórico OR-Tools permanece somente no benchmark externo. Rust 1.100.0, upstream fixado, dependências e Cargo.lock não foram alterados.

Mudanças em quatorze arquivos de código/testes e neste relatório. Comparador externo, fixtures, asserções públicas anteriores, inventário, workflows de qualificação e limites existentes foram preservados. Não houve merge, deploy, build Docker ou atualização da main, Timefold #74 ou branch original do PR #75.

## Correções

### Não piora por componente e recuperação

O teste público reproduziu a aceitação de uma melhora lexicográfica com PEOPLE_CHANGED de 0 para 3 e STABILITY de 0 para 12. A aceitação final agora exige que nenhum componente piore em relação ao incumbente viável produzido pela construção, além das proteções existentes de setor, serviço, liderança e folgas. A recuperação de um incumbente inicialmente inviável continua possível.

Custos do candidato nativo e do resultado devolvido permanecem reais. `componentGuardPreserved` registra a checagem adicional. Uma rejeição restaura a escolha anterior, sem fabricar telemetria, prova de ótimo ou melhoria que não ocorreu.

A primeira versão expôs três regressões nos casos públicos de recuperação de setor vazio. Foram corrigidas antes da publicação: uma sugestão completa com déficit estimado passa pelo reparo existente durante a construção, dentro do mesmo prazo, antes de definir a referência do refinamento. Uma grade completa já coberta permanece preservada. Sugestões não viram bloqueios; bloqueios reais continuam obrigatórios. Os quatro subcasos originais de recuperação passaram junto com a asserção original de não piora por componente.

### Histórico noturno e datas civis

A estrutura de um turno histórico deixa de ser confundida com sua autorização como alternativa atual. Fechamento explícito continua limitando novos turnos; um registro histórico não reabre a operação. A entrada legada sem fechamento informado conserva a possibilidade de turnos que cruzam a meia-noite. A admissão sintética permanece separada.

O trabalho da noite imediatamente anterior ao horizonte possui uma posição imutável própria no registro de presença, separada dos 42 dias solicitados. Seu serviço real pode atender a primeira manhã, sem criar uma atribuição nova. A recomputação integral, o acumulador incremental, a prova otimista de capacidade, as proteções privadas e a construção contabilizam essa fronteira civil. Cada pessoa é contada uma vez por intervalo.

Refeição não conta como trabalho. Pausa remunerada conta na ocupação civil paga, mas não fornece cobertura horária. DUTY e pessoas excluídas não recebem crédito de serviço com horário. Os testes verificam que trabalho anterior não invade afastamento ou folga atual e que trabalho atual não invade folga futura publicada. Uma data futura desconhecida não é inventada como trabalho.

A distribuição dominical contabiliza a data civil ocupada por trabalho iniciado no sábado anterior, sem duplicar o domingo. Uma rejeição por sequência de domingos inteiramente passada também foi reproduzida e corrigida: o histórico continua limitando janelas que alcançam o horizonte atual, mas uma violação imutável anterior não torna impossível uma escala corretiva atual.

A interface pública `occupied_dates` foi restaurada como cálculo puro de datas civis, sem dependência de otimizador. Testes independentes verificam pausa paga, refeição, término exclusivo à meia-noite e mudança de ano. Essas correções não constituem certificação jurídica nem implementação integral de hora noturna reduzida ou de toda combinação temporal possível.

## Testes e revisão

Foram acrescentados dez testes Rust e quatro testes Python, incluindo dois caminhos HTTP autenticados reais. As quatro regressões nativas iniciais falharam antes da implementação. A regra de domingos inteiramente passados também teve falha reproduzida. O acumulador com trabalho anterior foi confrontado com a recomputação integral ao alterar escolhas, retirar atribuições, retrair entidades e reiniciar o acumulador.

Há testes de preservação de serviço, pausas, ausência, folga, fechamento explícito e sugestões com déficit recuperável. Dois avisos de Clippy nos testes novos foram corrigidos sem supressões ou redução de asserções. Não houve revisão por subagente autônomo nesta rodada.

## Validação executada

Laboratório isolado Linux x86_64/GNU, Rust 1.100.0. Os quatorze blobs de publicação foram conferidos por hash; as fontes Rust são idênticas à cópia compilada.

| Verificação | Base d445f7f | Candidato desta rodada |
|---|---:|---:|
| Testes Rust completos aprovados | 126 | 136 |
| Testes Python do experimento aprovados | 45 | 45 |
| Transporte, fases, HTTP, presença e ocupação civil | 65 | 69 |
| Suíte pública completa: testes executados | 246 | 250 |
| Suíte pública: falhas | 2 | 1 |
| Suíte pública: erros | 3 | 0 |
| Suíte pública: ignorados | 0 | 0 |

Clippy all-targets com -D warnings, build release, Ruff, Cargo.lock e git diff --check passaram. Os 69 testes de fronteira integram a suíte pública, não são cobertura independente adicional. As asserções originais de objetivos, jornadas noturnas e recuperação de setores vazios permanecem inalteradas.

A suíte completa sem filtro terminou com `FAILED (failures=1)`, em 250 testes. Sua única falha é `test_every_retired_test_has_a_reviewed_migration_disposition`: 355 contratos históricos ainda exigem portabilidade ou revisão explícita. A execução continua reprovada e não autoriza main. A ausência de outras falhas nesta suíte não prova a implementação dos contratos ainda ausentes.

## Bloqueios restantes

Os 481 registros históricos e as 355 pendências permanecem intactos. Nenhum item foi marcado revisado nesta rodada. A próxima etapa é recuperar e revisar esses contratos, priorizando cobertura, domingos, refinamento por cargo e reparos setoriais, com rastreabilidade para as fontes históricas.

Permanecem obrigatórias a não inferioridade ampliada por cargo/faixa, vigência parcial, dezembro e domingos, a validação ARM64/musl do novo commit, contêiner/segurança/E2E e as 32 repetições de desempenho e estabilidade. O benchmark ampliado e a medição de estabilidade não foram executados nesta rodada. Não há declaração de ganho geral de desempenho ou prontidão para main.

Publicação somente na branch consolidada, sem força ou reescrita de histórico. O workflow temporário de transporte de objetos Git verificados por hash é removido da árvore final; seu sucesso não é qualificação do motor.

## Evidências

Diretório: `/vercel/lab/contracts-round6`. SHA-256 dos logs finais:

- Rust: `18e81eb80bc1079ff2d0ecc9c29a8e4ad3a811813ef5e1fb116e8fd173df8cda`.
- Clippy: `f5c6bed8d6655a375ad74428515ae758a523d3197712506f603c38a3dbad56dc`.
- Build: `aaa4004ddcd17ea4c0ce9855320e756dd6aa1f0058bf6152469961ca0af2b939`.
- Fronteiras: `c3f0fc6683258f1ba0b87aefc579e246f67a3953cc975f05d2f233b432d77d1b`.
- Suíte pública completa: `ab7c7a19b297849d4161edc832135ac2256e5c29f5772dad5da8643877ab1589`.
