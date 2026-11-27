# SolverForge — rotação, jornadas e registros preservados; main bloqueada

Atualização: 27/11/2026. Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base: `00df1500e77676bdf12b1806aaecc5d1420035dd`.
Árvore de código compilada e verificada antes desta atualização documental: `c132641aaccca05e9e99c930061edcf1c574ff8d`.

## Runtime e escopo

O runtime continua exclusivamente SolverForge, com Python para transporte HTTP, autenticação, validação e supervisão. Não há fallback OR-Tools/CP-SAT. O controle histórico OR-Tools permanece fora do runtime, somente no benchmark externo. Rust 1.100.0, upstream fixado e Cargo.lock foram preservados.

Foram modificados oito arquivos de código/testes, incluindo o novo módulo de admissão de jornadas, além deste relatório. Não houve alteração do comparador externo, fixtures de benchmark, objetivos de qualidade, limites de busca, dependências, lockfile ou inventário de migração. Nenhum teste público existente foi removido ou teve suas asserções reduzidas. Não houve merge, build Docker ou deploy.

## Correções reproduzidas e verificadas

### Rotação dos colaboradores sem horário

O cenário público de quatro líderes com cargos distintos, quatro semanas e regra dominical protetiva deixava o setor sem ninguém em um domingo. O defeito foi reproduzido no teste Python original e em uma regressão Rust antes da correção.

A expansão do catálogo agora considera rotações de semanas completas para colaboradores sem horário, verificadas contra as opções diárias originais, bloqueios, histórico e contexto futuro. A seleção das testemunhas respeita primeiro o custo de rotação sem horário, já existente no escore. Não foram inventados mínimos de presença, alterados os agrupamentos por cargo ou convertido DUTY em cobertura horária. Permanecem o limite de 384 caminhos, 8.192 tentativas e os prazos existentes.

O teste público original passou: pelo menos dois DUTY em cada data, cinco dias de trabalho e duas folgas por semana para cada colaborador, duas jornadas dominicais por pessoa e nenhuma referência de turno inventada. Isso demonstra esse cenário, não toda a não inferioridade ampliada.

### Jornadas manuais, pausas e simulação

O serviço separa a estrutura de uma jornada de sua admissibilidade para cada pessoa/data. Uma alternativa manual acima do limite não invalida automaticamente toda a solicitação: pode resultar em uma folga legal, mas nunca ser substituída silenciosamente ou satisfazer cobertura obrigatória. Quando não existe padrão pessoal admissível, a resposta usa a prova de domínio exaustivo vazio, com diagnóstico, sem relaxar bloqueios.

Pausas remuneradas contam somente na duração creditada, não como refeição ou serviço horário. A duração curta de simulação depende dos campos explícitos já previstos no contrato original; fora da simulação não há esse desvio. O reconhecimento sintético continua separado e estrito. Jornadas noturnas/contexto além da meia-noite continuam com limitações explícitas, não foram declaradas implementadas nesta rodada.

### Colaboradores excluídos e integridade da resposta

Pessoas com planningEnabled=false não entram nas entidades de otimização. Seus registros protegidos são preservados literalmente; em HOURS_ONLY todos os registros existentes dessas pessoas são mantidos. Um WORK preservado de pessoa excluída não atende demanda. Setores sem entidades ativas são verificados com capacidade zero, em vez de serem ignorados na prova de cobertura.

O transporte rejeita registros excluídos novos, removidos ou alterados, duplicatas e mudanças indevidas de tipo/metadados em HOURS_ONLY, inclusive a perda de um campo explicitamente nulo. As jornadas permitidas continuam podendo mudar apenas o relógio quando o contrato permite. Há testes positivos e adversariais de integridade e dois novos caminhos HTTP reais.

Entradas exclusivamente com pessoas excluídas e estimativas positivas em setores sem participantes ativos continuam explicitamente não suportadas; não são apresentadas como escalas viáveis nem têm seu custo omitido silenciosamente.

### Feriados configurados e tamanho das equipes

Feriados remunerados expressamente configurados são aceitos conforme sua presença simultânea em paidHolidayDates, closedDates e holidayDates, sem inferir novas datas. Um bloqueio de trabalho ou folga comum incompatível com esse feriado produz conflito comprovado, não erro de esquema. O teste original do feriado no início parcial de dezembro passou, preservando as duas folgas regulares.

O serviço admite equipes de até 250 pessoas também no horizonte semanal, mantendo os limites sintéticos anteriores. Um teste com 76 colaboradores sem horário verifica o compartilhamento real do catálogo e ausência de turnos inventados. O total de padrões distintos em cache é limitado a 360.000, preservando o envelope máximo anterior de doze perfis de 30.000 caminhos; entradas acima desse limite são rejeitadas explicitamente. Não houve medição de ganho geral de memória ou desempenho.

## Validação local executada

Ambiente Linux x86_64/GNU isolado, Rust 1.100.0. Os oito blobs publicados foram comparados com os arquivos verificados; as fontes Rust também foram comparadas byte a byte com a cópia compilada.

| Verificação | Base 00df150 | Candidato desta rodada |
|---|---:|---:|
| Testes Rust completos aprovados | 109 | 116 |
| Testes Python do experimento aprovados | 45 | 45 |
| Testes HTTP/processo aprovados | 49 | 54 |
| Suíte pública completa: testes executados | 229 | 234 |
| Suíte pública: falhas | 4 | 3 |
| Suíte pública: erros | 53 | 27 |
| Suíte pública: ignorados | 0 | 0 |

Clippy all-targets com -D warnings, build release, Ruff, conferência do Cargo.lock e git diff --check passaram. Foram acrescentados sete testes Rust e cinco testes Python, sem retirar os existentes. Os 54 testes HTTP/processo estão contidos na suíte pública, não são cobertura adicional independente.

A suíte pública completa continua REPROVADA: a execução final sem filtro terminou com 3 falhas e 27 erros. O resultado final foi novamente verificado após a última correção de integridade de metadados. Não se confunde aprovação nativa ou de transporte com equivalência funcional.

## Pendências e impedimentos de release

As três falhas restantes são o bloqueio de prontidão da migração e duas expectativas antigas de controle cooperativo da busca. Os 27 erros compreendem 20 ocorrências de entrada ainda não suportada, seis dependências de auxiliares da implementação anterior e uma incompatibilidade de validação. Esses contratos não foram descartados para liberar a CI.

O inventário preserva os 481 registros históricos e mantém 355 pendências de portabilidade ou revisão explícita. Continuam necessárias a equivalência das políticas/calendários ainda não admitidos, os contextos noturnos, a recuperação de escalas e a revisão dos contratos internos antigos. A não inferioridade ampliada por cargo/faixa, vigência parcial, dezembro e domingos, a validação de contêiner/segurança e as 32 repetições de desempenho não foram executadas para este candidato. Ganhos de versões anteriores não certificam o runtime atual.

Publicação somente na branch consolidada, sem força nem reescrita de histórico. Main, Timefold #74, produção e a branch original do PR #75 não foram alterados por esta intervenção. O workflow temporário usado exclusivamente para transportar objetos Git verificados por hash foi retirado da árvore final; seu sucesso não é qualificação. A CI ARM64 existente e sua verificação pública sem filtro permanecem obrigatórias.

## Evidência local

Diretório de retomada: `/vercel/lab/contracts-round4`. SHA-256 dos logs:

- Rust: `690eea1e30cad39398a34ff507e05571079a412d5f3e869a6e57c68df9b1eeb4`.
- Clippy: `406a44c18ada2a36c939852b95766b44817fd22ab3e791bff1b23ef028a74a02`.
- Build: `ebdb9aaa57e4b68de8d48817e69880e0377a4336b51cd1612e73cc95dfb3fadf`.
- HTTP/processo: `70169132127d079f292f684b784e60bd8327a24897a9289108455be89e551031`.
- Suíte completa final: `7a3ee0f5ca2bc2e159fb7fa450173f609b7377e0183bea92bd920f7c8956a9ab`.
