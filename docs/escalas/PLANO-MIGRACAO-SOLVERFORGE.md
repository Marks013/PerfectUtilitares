# Migração de Escalas para SolverForge — plano de execução

Avaliação inicial: candidata `074d299a5bfa02c02df6d003f44cc2f973bd217c`, controle imutável OR-Tools `f78c691edbeaf16283f534bcacd8db1b4b7d5e66`. O OR-Tools segue oficial. Este plano não autoriza trocar o motor, executar contra o banco de produção, gravar grades ou publicar dados.

## 1. Desbloquear entradas e medição em paralelo

| Frente | Problema observado | Correção e critério de aceite |
| --- | --- | --- |
| 1A — Domínio de turnos | Serviço aceita 12/4 onde o app admite 120/12. Um turno 13 ou uma opção 5 pode rejeitar o planejamento antes da busca. | Ampliar o domínio do serviço sem truncar opções. Remover suposições de arrays/máscaras do domínio antigo, preservar os limites do experimento sintético e provar 13/5, máximo 120/12, excesso, bloqueios e relógio único. Validar a resposta nativa pela rota autenticada. Não aumentar o orçamento para esconder custo. |
| 1B — Turnos manuais | O adaptador nativo rejeita procedência de trocas por período mesmo com a escolha canônica resolvida por data. | Consumir escolha e base explícitas sem editar o rascunho, preservar validade das opções, exceção mensal somente no dia autorizado, limpeza e estabilidade. Provar fluxo válido e recusar metadados inconsistentes. |
| 1C — Benchmark | O workflow roda o avaliador na árvore candidata, que a guarda de identidade rejeita antes do primeiro cenário. | Manter checkout limpo do OR-Tools, provar equivalência dos arquivos do avaliador original e registrar identidades distintas do executor, controle, candidata e imagens. Não desabilitar a trava. Executar o fluxo automatizado sobre uma revisão qualificada. |

## 2. Paridade operacional, sem afrouxar regras

1. Reconciliar os 328 itens sem disposição dos 481 históricos: teste público preservado, contrato portado com evidência, ou teste interno de CP-SAT aposentado com justificativa e cobertura comportamental equivalente. Não mudar o gate nem usar porcentagem de testes como substituto da prova.
2. Priorizar jornada parcial/viradas domingo–sábado, feriados e fechamento, afastamentos, jornada noturna e continuidade civil, descansos entre jornadas, horário único, turno manual, domingo por cargo/faixa, liderança e setores esvaziados. Separar mínimos obrigatórios de estimativas e preservar o comportamento de referência.
3. Verificar semântica de estado: proposta legal não é ótimo provado; falta de solução em domínio amostrado/tempo limitado é inconclusiva, nunca inviabilidade sem prova. Registrar separadamente entrada inválida, limitação do motor, prazo e erro operacional, sem dados pessoais.
4. Critério: inventário fechado e revisão aprovada; suíte focal Rust/Python/TypeScript e HTTP; compatibilidade integral, ARM64/musl e E2E na imagem exata. Não reutilizar resultado de revisão anterior.

Ordem da revisão do inventário:

| Ordem | Grupo de risco | Evidência mínima antes de dar baixa |
| --- | --- | --- |
| P0 | Jornada, vigência, relógio mensal, bloqueio, feriado/ausência, continuidade noturna e troca manual | Casos válidos e inválidos atravessam o serviço real; verificação independente destaca a pessoa/data afetada, sem expor dados do cadastro. |
| P0 | Cobertura obrigatória e presença protegida | Uma falta em cargo/faixa não pode ser compensada com outra função, data ou faixa. Provar recusa de perdas e aceitação de redistribuição equivalente. |
| P1 | Domingos, setor vazio, liderança e concentração/pares de folga | Reproduzir primeiro os recortes mais críticos: inventário inicial tem 41 pendências no grupo de produção dominical, 16 de pico e 14 de refinamento de cargo. Distinguir regra obrigatória de preferência de qualidade. |
| P1 | Tempo, cancelamento, escolha de proposta e estados inconclusivos | Comparar tempo até a primeira solução, reuso, falhas e a resposta ao atingir prazos. Não contabilizar proposta reaproveitada como novo ganho. |
| P2 | Instrumentação interna do CP-SAT | Aposentar apenas com motivação específica e equivalente público executado; preservar identidade e hash históricos. |

## 3. Comparação paralela e otimização

Comparar OR-Tools e SolverForge sem gravação, com casos sintéticos e as nove filiais desidentificadas, nos três modos. Fixar o conteúdo de entrada, calendário, revisão e demanda, perfis de carga, sementes quando suportadas, CPU/memória, aquecimento e orçamento. Incluir semanas parciais, dezembro, períodos subsequentes, jornadas mistas e menor equipe. Conservar também cenários de reserva fora da calibração.

- Aceite primário: zero proposta inválida, zero deterioração dos mínimos ou da cobertura por setor/cargo/faixa e domingos; conferir especialmente abertura, fechamento, dias sem equipe, concentração e folgas consecutivas. Acompanhar qualidade estimada sem convertê-la em regra obrigatória.
- Medição: taxa de propostas comparáveis por motor e modo; inconclusivos, erros e reaproveitamentos separados. Medir P50/P95 e RSS ponta a ponta, tempo até primeira proposta válida, preparação e busca; repetir cargas representativas (32 por perfil de cauda aprovado), não só um caso de 50 pessoas. O ganho histórico de ~79% foi interno ao SolverForge, não contra o OR-Tools.
- Só após perfil medido: otimizar representação de catálogos, reuso por geometria equivalente e fase que domina CPU/memória. Preservar preferências/desempates pessoais, nunca agrupar alternativas com consequências diferentes em pausas, fechamento ou cobertura.

## 4. Homologação e eventual entrada em produção

Executar prova autenticada de geração real em fixture, cancelamento, limpeza da vaga e nova geração na imagem final: `/health` isolado não testa o motor. Conferir autenticação/escopo, telemetria agregada, app/worker/Solver no mesmo release e ensaiar retorno por digest da tríade. Primeiro comparar em paralelo sem gravação, depois piloto explicitamente autorizado que mantenha OR-Tools disponível. Não planejar virada integral sem aprovar os marcos anteriores e sem autorização humana própria.

## Diário de execução

- 27/11/2026 — cópia local isolada da branch experimental confirmada na revisão inicial. Controle principal e checkout de PDF preservados. Frentes 1A/1B/1C são independentes onde seus arquivos não se sobrepõem. Evidências desta implementação vão abaixo; avanço depende do resultado, não apenas de haver código.
- Implementação local — 1A amplia catálogo/opções no serviço sem podar referências válidas. Em domínios semanais largos, a busca examina janelas limitadas que cobrem cada relógio, não todas as combinações. Uma amostra esgotada não prova inviabilidade; a resposta fica inconclusiva. 1B valida a procedência e a geometria de trocas manuais por período e não usa o turno escolhido fora dos dias autorizados.
- Comparação — 1C isola o avaliador OR-Tools na revisão histórica tanto no benchmark quanto no smoke entre motores. O comparador liga a candidata e os arquivos do ensaio à identidade Git/OCI; mudanças no controle e divergências de identidade falham. Três provas da guarda passaram, incluindo adulteração do avaliador, do harness e do controle. A análise TypeScript e a sintaxe dos dois workflows passaram; nenhum ensaio comparativo completo foi executado.
- Aplicativo — diferencia configuração não suportada, resposta inválida, entrada inválida e indisponibilidade, sem devolver detalhes privados nem orientar alterações indevidas no cadastro. Passaram 46 testes de interface/rota, 6 de transporte e a checagem TypeScript no Node 24.19.0 do projeto. A execução dos testes de transporte no Windows simulou apenas a permissão POSIX da chave fictícia da fixture; nenhum guard de produção foi alterado.
- Núcleo — 184 testes Rust e Clippy estrito aprovados em Linux x86-64/musl com Rust 1.100.0 e upstream congelado. Passaram 54 provas dos verificadores Python e seis do registro de procedência dos testes; a fixture de hash foi corrigida para gravar bytes UTF-8 sem conversão de quebra de linha. Nenhum dos 328 itens recebeu baixa sem evidência equivalente.
- Serviço — binário release estático (SHA-256 `085455716d6ba92450c88dd0dc2e6b01fedcba501d117ee5a356f2360b04f6a0`), Cargo.lock conferido. Os 39 testes focais passaram em 11,5 s, sem rede externa, no serviço local com autenticação e binário real. Comprovados: uso da última opção de 13/5 e 120/12 em cobertura obrigatória, recusa acima dos limites, troca manual só nos dias de trabalho autorizados, recusa de mapa/base/modo incompatíveis e bloqueio, cancelamento seguido de nova geração. A primeira prova da troca manual expôs uma fixture sem o `TIMED` obrigatório; a fixture foi corrigida conforme o esquema original e os casos foram executados novamente.

**Decisão atual:** fase 1 aprovada no escopo focal local; não é aceite para trocar o motor. `readyForMain=false`; permanecem 328 contratos para revisão, a qualificação integrada da imagem/ARM64 e E2E, o primeiro benchmark pareado completo nesta árvore e as entradas das nove filiais desidentificadas e congeladas para comparação. Qualificar primeiro o bloco P0 e executar o benchmark com controle e candidata em imagens diferentes. Não comparar números históricos como se fossem resultados deste código.
