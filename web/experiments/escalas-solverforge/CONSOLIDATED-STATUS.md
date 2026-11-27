# SolverForge — recuperação de contratos e auditoria Git; main bloqueada

Atualização: 27/11/2026. Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base funcional: `ed9099a4aad9a3da43d9679bf954f2906daabf0d`.
Base após limpeza de referências: `074d299a5bfa02c02df6d003f44cc2f973bd217c`, com árvore idêntica à base funcional.
Árvore de código/testes/inventário e auditoria conferida: `8b5251d2d29405333c0984d6d11cda0366c5423e`.

## Diagnóstico da execução anterior

O artefato ARM64 15224971910 da execução 46050746385 foi baixado e conferido por SHA-256 `ef56deeb164cfbb99aa3a84a485837b30101039420880e115cc78f6cda780c19`. A suíte pública de ed9099a executou 261 testes em 262,836 segundos, com uma falha, zero erros e zero testes ignorados. A única falha foi `test_every_retired_test_has_a_reviewed_migration_disposition`, devido a 328 contratos históricos ainda pendentes. Não foi uma nova falha de compilação nem um resultado de benchmark.

O gate não foi removido, filtrado, transformado em aviso ou marcado como expectedFailure. A correção integral da prontidão ainda exige concluir os contratos restantes e as demais qualificações.

## Correção funcional encontrada durante a portabilidade

O contrato histórico aceita `sundayRestRule: null` como ausência de exceção revisada, aplicando proteção dominical de um domingo consecutivo. O serviço nativo rejeitava essa entrada com SOLVER_UNSUPPORTED_INPUT/422. A falha foi reproduzida no serviço real antes de modificar o código.

A leitura agora aplica PROTECTIVE exclusivamente ao null opcional no serviço real. O modo sintético permanece estrito. Não foram alterados os limites de domingos: COMMERCE mantém o teto configurado de um ou dois, e os demais perfis mantêm um. Booleanos, números, listas, objetos, strings desconhecidas e strings vazias continuam rejeitados.

Os testes conferem tanto o conflito de trabalho bloqueado em dois domingos consecutivos quanto o caminho de sucesso HTTP autenticado: sete atribuições, cinco dias de trabalho, folga no domingo protegido e entrada intacta. Não há desbloqueio silencioso nem flexibilização de cobertura ou regras.

## Vinte e seis contratos históricos recuperados

Foram recuperados seis contratos públicos de carga/horários/simulação, oito de feriados e ausências, sete de serviço/cancelamento, um de inicialização autenticada e quatro contratos nativos de limites e domingos.

Os seis corpos de testes de carga/simulação e suas asserções foram preservados. A soma de minutos usa uma verificação independente dos segmentos WORK/PAID_BREAK efetivamente devolvidos, sem reintroduzir auxiliares CP-SAT. Permanecem os valores exatos das transições semanais e das jornadas curtas.

Os testes de feriados mantêm datas, registros protegidos, contagens de trabalho/folgas/feriado, horários importados e diagnóstico de inviabilidade. O Natal continua exigindo exatamente 2.016 minutos no cenário original. A antiga injeção de MAX_SECONDS específica do CP-SAT foi retirada apenas do auxiliar de testes; os orçamentos do serviço nativo não mudaram. Os casos históricos de 2022/2023 não foram silenciosamente deslocados para 2026/2027 e continuam pendentes.

Os contratos HTTP recuperam replay, cancelamento prévio idempotente, isolamento por capacidade, duas repetições de cancelamento com 120 colaboradores/seis semanas, liberação da vaga e sucesso da solicitação seguinte. Um processo realmente não cooperativo verifica timeout e limpeza. O teste de cancelamento entre threads espera a fase real REFINEMENT do Rust, mantém o limite de parada de dois segundos e confirma que o processo exato foi recolhido e deixou de existir em /proc. A instrumentação observa Popen real, sem substituir a busca por uma resposta fabricada.

Cada portabilidade mantém identidade histórica, revisão de origem, hash do corpo original, justificativa, destino executável e hashes de destino. Os 481 registros históricos foram preservados. Somente após a aprovação nominal dos testes, 26 entradas passaram a ported_native_contract: 328 pendências tornaram-se 302. readyForMain permanece false. O verificador existente de integridade dos destinos passou sem alterações.

## Validação final local

Ambiente isolado Linux x86_64/GNU, Rust 1.100.0. As fontes foram comparadas byte a byte com a cópia compilada e os blobs enviados ao GitHub. Nenhuma dependência ou Cargo.lock mudou.

| Verificação | ed9099a | Código desta rodada |
| --- | ---: | ---: |
| Testes Rust completos aprovados | 179 | 184 |
| Testes Python do experimento aprovados | 45 | 45 |
| Transporte, fases, HTTP, presença e ocupação civil | 75 | 83 |
| Testes executados na suíte pública completa | 261 | 284 |
| Falhas na suíte pública | 1 | 1 |
| Erros / testes ignorados | 0 / 0 | 0 / 0 |
| Contratos históricos pendentes | 328 | 302 |

Clippy all-targets com -D warnings, compilação release, Ruff, conferência do lockfile e git diff --check passaram. Os 83 testes de fronteira integram a suíte pública completa; não constituem cobertura adicional independente. O conjunto direcionado dos arquivos restaurados executou 54 testes, todos aprovados.

A suíte pública final terminou em 335,232 segundos com **FAILED (failures=1)** e código de saída 1. A única falha permanece sendo a exigência de zero contratos históricos pendentes. Não se declara aprovação do gate nem equivalência dos 302 contratos ainda ausentes. A rodada acrescentou cinco testes Rust e 23 métodos de teste Python; a restauração do fixture original de startup não aumentou a contagem de métodos.

## Limpeza de branches, PRs e tags

A pedido explícito do usuário, os PRs #74 (Timefold) e #75 (linha SolverForge anterior) foram fechados sem merge. Dez branches remotas antigas foram excluídas após conferência dos nomes e SHAs. Somente main e a consolidada permaneceram. A main não foi modificada e segue em f78c691edbeaf16283f534bcacd8db1b4b7d5e66. O workflow de limpeza 46053093762 foi concluído, e seu arquivo temporário foi removido em 074d299.

A auditoria de tags está em `docs/git/TAGS-AUDIT-2026-11-27.md`: 11 tags anotadas válidas, zero destinos duplicados ou referências quebradas, nenhuma release. Nove destinos pertencem à ancestralidade das branches mantidas; dois preservam histórico fora dela. Todas as tags possuem referências documentais de recuperação, de modo que nenhuma foi removida, renomeada ou movida. A verificação de conectividade passou, e os hashes dos objetos de tag e dos commits foram recalculados sem divergência. Não foi inventada assinatura nem criada uma release do motor ainda bloqueado.

## Limites preservados e pendências

O runtime permanece exclusivamente SolverForge. OR-Tools continua apenas como controle histórico externo. Os comparadores, cenários, esquema HTTP, prazos, regras e workflows permanentes de qualificação ficaram inalterados. Os métodos de teste públicos já presentes nos arquivos de serviço e feriados foram conferidos por AST e preservados; o método de startup voltou ao cenário original, mantendo as asserções.

Continuam pendentes os 302 contratos, a não inferioridade ampliada por cargo/faixa/presença/dezembro/domingos, contêiner/segurança/E2E e 32 repetições de desempenho e estabilidade. Esses benchmarks não foram executados nesta rodada. Não se afirma implementação integral de hora noturna reduzida nem paridade completa de objetivos.

Não houve merge, deploy, alteração de main, acesso ao servidor/DB produtivo ou redução de proteção de referências. Não houve revisão por subagente autônomo. O workflow temporário de transporte de blobs é excluído da árvore final; seu sucesso não é qualificação do motor.

## Evidências e retomada

Workspace local: `/vercel/solverforge-round9`, originalmente baseado em ed9099a. Logs e inventários: `/vercel/lab/contracts-round9`. Retomar a próxima rodada a partir de uma worktree limpa do commit finalmente publicado, preservando este diretório de evidências.

SHA-256:

- Rust: `198c6d7cd80807e146877c2f49dffa0932779cac54c1bb472510ad73a4877ad0`.
- Clippy: `e4aa705b0e0b11ef915244102bdfeeaba06339ce3c625d261ebcfc9aab31caf3`.
- Build: `c664a3bf7ef33dd69663af1135027b774d104e1241cee0ece1d975a493557d5f`.
- Fronteiras: `f6444779f7ef4916fb84379309c4c95f6d52b43e09a6dbf363f43df8733e1688`.
- Suíte pública: `e8a29b4be9a7023a01eec325b48808f99ae58ed8baf62cabba63c399cfd58f55`.
- Auditoria de tags: `0e0e41f019d1caef1004af050403434155224e32f7f6beb41709d6ddc5e32211`.
