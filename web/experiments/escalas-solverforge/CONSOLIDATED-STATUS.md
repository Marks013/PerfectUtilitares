# SolverForge — contratos recuperados; main continua bloqueada

Atualização: 27/11/2026. Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base desta rodada: `c08e5a588c21902fd99b8be83156a12bac89aabe`.
Árvore de código efetivamente compilada e testada, antes desta atualização documental: `2823f2b698f1e850a71c51054d6d590c4c7f3c3b`.

## Runtime preservado

O serviço desta branch continua chamando exclusivamente o executável SolverForge por `--service`. O Python mantém transporte HTTP, autenticação, validação estrutural, prazos, cancelamento e supervisão de processos. Não há fallback OR-Tools/CP-SAT. O controle OR-Tools histórico permanece isolado no benchmark, fora do runtime.

Rust 1.100.0, upstream `78889c3ff9fda158c70e6a1f67f8c7f0fdae922e` e Cargo.lock permanecem fixados. Não houve alteração do comparador, das fixtures externas, dos limites de execução, das verificações de aprovação ou do inventário histórico. Não houve build Docker, deploy ou merge. A limpeza e a equivalência funcional não são declaradas completas.

## Correções desta rodada

### Calendário de seis semanas

O teste de 150 pessoas, 42 dias e 6.300 demandas estimadas expôs um panic. A admissão de semanas iniciadas na segunda-feira estava correta, mas a agregação de custos reutilizava o deslocamento do dia civil para indexar a semana de planejamento. O último domingo tentava acessar o índice 6 de um vetor de seis posições.

A regressão foi reproduzida em um teste nativo antes da correção. `TemporalFacts` agora separa `week_offset` de `weekday_offset`. O último domingo permanece na sexta semana; nenhuma data, demanda ou regra foi descartada. O teste público original de 6.300 demandas passou depois da correção.

### Provas de conflito de cobertura

O novo módulo `temporal/feasibility.rs` calcula condições necessárias sobre uma aproximação otimista das disponibilidades legais. Para uma semana usa a enumeração pessoal completa; em horizontes maiores usa as opções anteriores à amostragem. Uma amostra incompleta nunca é usada para afirmar inviabilidade.

Verifica capacidade obrigatória por data/cargo/faixa, proteções de presença, limites privados de desfalque e a capacidade semanal de dias trabalhados. A desigualdade por dias civis é omitida quando há jornada que cruza meia-noite, pois cinco jornadas podem ocupar mais de cinco datas. DUTY, folgas, afastamentos e intervalos não são contados como trabalho com horário.

Somente uma contradição dessas condições produz INFEASIBLE com `proofMethod=RELAXED_CAPACITY_BOUND`, atribuições vazias e diagnóstico COVERAGE. Expiração continua timeout; falta de resultado na busca amostrada continua UNKNOWN. O diagnóstico de uma faixa impossível informa a data e o horário efetivos. O teste público do almoço passou com suas asserções originais, incluindo 12:00 e a explicação sobre intervalos de refeição.

A segurança do certificado foi confrontada com todas as 128 combinações de dias exigidos de um domínio semanal exato, além de testes contra falsa inviabilidade por redução de catálogo e contra uso após o prazo.

### Metadados e entrada pública

O serviço passou a devolver custos inicial/final e tempos efetivamente medidos. `optimization.method=BOUNDED_LEXICOGRAPHIC_SEARCH`, `globalOptimalityProven=false` e `partialModel=true`. Os elementos de `phases` são identificados como níveis do escore lexicográfico, não buscas sequenciais independentes, e não recebem prova de ótimo. O indicador de liderança deriva das atribuições efetivas e não é convertido em cobertura horária.

Identificadores opcionais de demanda e metadados legados omitidos são aceitos conforme o contrato público existente. Valores explícitos malformados continuam rejeitados; identificadores de colaboradores e payload não são reescritos. A admissão sintética continua separada e estrita. Há dois novos testes de sucesso HTTP real para metadados e conflito comprovado.

## Verificação executada

Laboratório Linux x86_64/GNU, Rust 1.100.0. Os arquivos publicados foram comparados byte a byte com a cópia compilada. Este resultado não equivale à homologação ARM64/musl, de contêiner ou de produção.

| Verificação | Resultado |
|---|---|
| Rust release, conjunto completo | 109 aprovados; zero falhas, ignorados ou filtrados |
| Python do experimento | 45 aprovados |
| Transporte, HTTP e processo | 49 aprovados |
| Clippy all-targets com -D warnings | Aprovado |
| Build release | Aprovado |
| Ruff, Cargo.lock e git diff --check | Aprovados |
| Suíte pública completa, sem filtro | 229 testes; 4 falhas, 53 erros; zero ignorados |

A suíte pública continua REPROVADA e terminou com código 1. Os 49 testes de transporte estão contidos nessa suíte, não são cobertura adicional independente. O registro anterior c08e5a5 tinha 227 testes, 17 falhas e 89 erros. Foram acrescentados nove testes Rust e dois testes HTTP, sem retirar asserções públicas existentes. A regressão nova de calendário teve um quantificador de teste corrigido para exigir que todos os dias pertençam às seis semanas; nenhuma asserção histórica foi afrouxada.

As 12 ausências de metadados optimization e as 13 asserções UNKNOWN versus INFEASIBLE do registro anterior não reapareceram no conjunto final. Isso é evidência deste conjunto, não prova de completude do modelo.

## Medição direcionada de diagnóstico

Três pares sequenciais com a mesma entrada inviável, um colaborador e seis datas obrigatórias na semana:

| Código | Mediana externa do processo | Resultado |
|---|---:|---|
| c08e5a5 | 11,001962 s | UNKNOWN |
| candidato desta rodada | 0,001355 s | INFEASIBLE com certificado de capacidade |

Todos os pares devolveram atribuições vazias. SHA-256 da entrada: `433be36630e7eaea793c54621d121ab186518ff15ce9a0225e9a6ea424b96051`.

É uma medição restrita de rejeição antecipada, não benchmark geral de escalas viáveis, ganho de qualidade ou qualificação de estabilidade. Não foram executados nesta rodada o comparador ampliado nem as 32 repetições; ganhos anteriores não certificam o código novo.

## Pendências verificadas

As quatro falhas finais são: o bloqueio de prontidão de migração, a rotação de líderes sem horário que ainda esvazia um setor e duas expectativas antigas de controle cooperativo da busca. Os 53 erros incluem 46 entradas ainda não suportadas, dependências de auxiliares removidos do solver anterior e uma incompatibilidade de validação. Não houve panic na execução final do caso de 6.300 demandas.

O inventário mantém 481 contratos históricos, dos quais 355 aguardam portabilidade ou revisão explícita de aposentadoria. Eles não foram considerados redundantes nem removidos para liberar a CI. Continuam obrigatórias a compatibilidade integral, a qualidade ampliada por cargo/faixa, vigência parcial, dezembro e domingos, a validação de segurança/contêiner e a comparação completa de desempenho antes de main.

## Publicação e preservação

Mudanças limitadas a cinco arquivos de código/testes e este relatório. O workflow temporário de transferência de objetos verificados por hash é removido da árvore final. A qualificação ARM64 existente e sua suíte pública sem filtro permanecem obrigatórias, com permissões de leitura. A transferência de objetos não é uma aprovação de release.

Publicação apenas na branch consolidada, sem força nem reescrita de histórico. Main, Timefold #74, a branch original do PR #75 e produção permanecem fora desta intervenção.

## Evidências locais

Diretório: `/vercel/lab/contracts-round3`.

- Rust completo: `3f9d60553c3eacebcfade070bffe7f4bcd546cafc03d75e2cc2a81ac97614a5e`.
- Clippy: `a05e9e001e57b86d472bc20c7a9f219314b9a613d9b5dbdf55517d13bbf08cbe`.
- Build: `9257d34735517fc5c5a0fa8a9ea59a981d733f1484489ba047fbbab53d04b403`.
- HTTP/processo: `3f74041fb13c2576d3cc14c8a7e14ff18938702292ff361768d1f7314c492fab`.
- Suíte completa: `47adb0873b33f013fba283692f6f5ad4cca1a8af05bc98c770ecb2108adba6af`.
