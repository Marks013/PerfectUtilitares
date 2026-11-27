# SolverForge — contratos públicos e cancelamento nativo; main bloqueada

Atualização: 27/11/2026. Branch: `experiment/solverforge-consolidado-2026-11-26`.
Base: `f8b86eb8be5c98790c892b50d8820b6376bbad82`.
Árvore de código compilada e testada, antes deste relatório: `be066f3e60091025fa10ee0afc7b6c0ff7324991`.

## Escopo preservado

O runtime continua exclusivamente SolverForge. O Python mantém autenticação, validação de entrada, transporte e supervisão do processo Rust; não há fallback OR-Tools/CP-SAT. O controle histórico OR-Tools permanece somente fora do runtime, no benchmark. Rust 1.100.0, upstream fixado, dependências e Cargo.lock não foram alterados.

O comparador externo, suas fixtures, verify_comparison.py, os workflows de qualificação e seus limites permanecem byte a byte iguais à base. Nenhum merge, deploy, build Docker ou alteração na main, Timefold #74 ou branch original do PR #75 foi realizado. A limpeza integral e a equivalência funcional ainda não estão concluídas.

## Correções realizadas

### Contratos de política e metadados

A admissão do serviço estava herdando proibições próprias do experimento sintético. Agora reconhece o perfil já previsto no produto, `SINDECOMU_SUPERMARKETS_2026_2027`, além de CUSTOM, e aceita os metadados documentais omitidos, nulos ou em objeto conforme o comportamento histórico inspecionado. Perfis desconhecidos e metadados explicitamente malformados continuam rejeitados. A admissão sintética permanece separada e estrita.

Campos documentais de revisão, validade e certificados não são tratados como autorização operacional nem como bloqueio inventado. Continuam obrigatórios os limites configurados, fechamentos, bloqueios de atribuições e restrições de folga do perfil reconhecido. Feriado aberto não é convertido em fechamento por ausência de autorização documental; feriado fechado não é reaberto por documento. Isso recupera o contrato do software, não constitui parecer ou certificação jurídica.

O máximo numérico de intervalo de refeição segue o contrato original: inteiro entre 121 e 360 quando explicitamente configurado; caso contrário, 120. Booleano não vale como autorização numérica. Configurações mixed42 fora do alvo semanal ou de um setor de correspondência exata são inativas, sem habilitar exceção. Um alvo pessoal que excede o teto semanal é avaliado como conflito real das restrições, em vez de erro de esquema.

### Calendário visível e recuperação de setor vazio

O calendário do serviço agora usa a interseção do mês visível com as datas realmente solicitadas. Não exige que uma solicitação semanal contenha o mês inteiro, não acrescenta dias e continua rejeitando um mês sem interseção. O calendário sintético conserva sua admissão anterior.

Essa rejeição de entrada impedia que os quatro casos públicos de recuperação de setor vazio sequer chegassem ao motor. Os quatro subcasos originais passaram, inclusive REST_ONLY/DAYS_AND_HOURS, sugestões iniciais e registros bloqueados, mantendo asserções de cobertura. Não é prova de não inferioridade ampliada.

Configurações legadas de folgas mantêm seus dias fixos reais sem receber a projeção estrutural reservada a fixedRestSlots. Quando as folgas tornam impossível cumprir a semana, o domínio exaustivo demonstra INFEASIBLE. A consistência estrita dos slots explícitos não foi removida.

### Cancelamento nas fases reais do SolverForge

O executável emite dois eventos fixos, sem payload pessoal: CONSTRUCTION e REFINEMENT, nos pontos em que essas fases realmente começam. Não são chamadas simuladas a um motor antigo. O stdout continua contendo somente a resposta JSON.

O supervisor lê o canal stderr com teto total de 4.096 bytes, aceita somente a sequência conhecida, rejeita duplicação, ordem inválida, fase desconhecida ou protocolo incompleto, e descarta mensagens não protocolares sem expô-las. O callback opcional on_phase é acompanhado por checkpoints. Exceções de cancelamento encerram e recolhem o processo/grupo possuído, sem devolver atribuições parciais ou status matemático falso.

Os testes incluem fragmentação de bytes, excesso de saída, protocolo malformado, ruído não exposto, cancelamento com verificação de que o processo filho foi encerrado, além do controle cooperativo sobre o executável real. Cancelamento na construção e no refinamento passou nos contratos portados.

### Equipes sem horário e metadados de objetivos

Para equipes exclusivamente UNTIMED/MISSING, valores horários de descanso são aceitos dentro do limite de inteiro, sem inventar intervalos de relógio. Os limites inferiores e a validação de tipo permanecem; equipes com qualquer participante com horário continuam submetidas às faixas anteriores. O teste original de presença sem intervalos horários passou, com cinco DUTY e duas folgas.

O relatório de otimização agora identifica CLOSING_COVERAGE como aplicável somente quando há demanda estimada realmente sobreposta ao fechamento. A pontuação, a ordem dos objetivos e os comparadores não foram alterados. Não há declaração de ótimo global nem apresentação dos níveis lexicográficos como buscas independentes.

## Portabilidade explícita dos testes antigos

Oito contratos existentes foram portados da instrumentação interna do CP-SAT para as fronteiras reais do SolverForge: três de controle cooperativo, dois de jornada manual, um de feriado fechado, um de prazo expirado e um de ordenação/qualidade dos objetivos.

Não foram recriados CpModel, _solve, _read_assignments ou hints artificiais só para satisfazer mocks. Os testes passaram a observar a resposta nativa antes do transporte, a chamada real de processo, os eventos efetivos de fases e cálculos independentes de carga/horário. Permanecem verificações de entrada imutável, cobertura, carga semanal, relógios manuais, ausência de bloqueios inventados, rejeição antes do processo e cancelamento sem resultado parcial. A introspecção de variáveis internas de hints do CP-SAT foi explicitamente aposentada, não apresentada como executada pelo novo motor.

Seis desses testes estavam no inventário histórico; foram marcados ported_native_contract com hash do corpo histórico e justificativa. Dois testes manuais que não constavam naquele inventário foram registrados separadamente em additionalPublicPorts. Os 481 identificadores históricos e todos os 355 itens ainda pendentes foram preservados. Nenhuma pendência foi apagada para liberar a prontidão. Um novo teste valida identidades, hashes e destinos executáveis.

Um teste Rust anterior passou a usar UNMODELED_POLICY para verificar a rejeição de perfil desconhecido, pois seu antigo exemplo tornou-se o perfil reconhecido. As novas regressões verificam separadamente aceitação e restrições desse perfil.

## Validação executada

Laboratório Linux x86_64/GNU, Rust 1.100.0. Fontes Rust comparadas byte a byte com a cópia compilada; árvore de publicação verificada por hashes Git. Os resultados não substituem ARM64/musl, contêiner, E2E ou produção.

| Verificação | Base f8b86eb | Candidato desta rodada |
|---|---:|---:|
| Testes Rust completos aprovados | 116 | 126 |
| Testes Python do experimento aprovados | 45 | 45 |
| Transporte, fases, HTTP e validação de presença | 54 | 65 |
| Suíte pública completa: testes executados | 234 | 246 |
| Suíte pública: falhas | 3 | 2 |
| Suíte pública: erros | 27 | 3 |
| Suíte pública: ignorados | 0 | 0 |

Clippy all-targets com -D warnings, build release, Ruff, Cargo.lock e git diff --check passaram. Foram acrescentados dez testes Rust e doze testes Python. Os 65 testes da fronteira fazem parte da suíte pública, não são cobertura adicional independente. A redução dos erros decorre tanto de correções funcionais como da portabilidade explícita dos oito contratos; não é atribuída exclusivamente ao algoritmo.

A execução pública final sem filtro continua REPROVADA: 246 testes, duas falhas e três erros, zero ignorados. Asserções de qualidade não foram afrouxadas.

## Bloqueios atuais comprovados

1. A prontidão da migração continua reprovada por 355 contratos históricos ainda sem portabilidade/revisão completa.
2. O teste portado de objetivos agora alcança a asserção original de não piora por componente e a reprova. Em reprodução direcionada, PEOPLE_CHANGED passou de 0 para 3 e STABILITY de 0 para 12. A busca lexicográfica aceita uma melhora anterior enquanto esses componentes pioram; a equivalência desse contrato permanece não demonstrada. Não alteramos a asserção, não fabricamos valores de fase e não declaramos eliminação da regressão.
3. Os três erros restantes envolvem jornadas que atravessam a meia-noite: invasão de data civil de afastamento, proteção de folga futura publicada e contabilização dominical do trabalho iniciado no sábado anterior. A funcionalidade continua explicitamente não suportada onde falta a modelagem completa; não foi convertida em inviabilidade fictícia.

Continuam necessárias a não inferioridade ampliada por cargo/faixa, vigência parcial, dezembro e domingos, a validação de contêiner e segurança, e as 32 repetições de desempenho/estabilidade. Nenhum desses resultados foi produzido nesta rodada para o novo candidato. Não há alegação de ganho geral de desempenho ou prontidão para main.

## Evidências e publicação

Diretório do laboratório: `/vercel/lab/contracts-round5`.

SHA-256 dos logs finais:
- Rust: `4f8f45ae9d328b7bb26dfb797dc75848e1451fcabb4678b4f2de33d5887bffd5`.
- Clippy: `6466b7c9794b958ce3acad1628d938f0d9248df27ab4b60b123c41db48cc6119`.
- Build: `dcef8d877bdb7f7fd17acf1528f782f1643bb937d57a8cb35e8d9f8417e00856`.
- Fronteiras: `57ad95ac443e85000603b8201858cb4a8ef25ea03ab9630acb2f810f5571f864`.
- Suíte pública completa: `3fda590eafb294a49978711e6c1d0a1016f99e1945b2f481acb82eae23fccbfc`.

Mudanças em dezoito arquivos de código/testes e neste relatório. O workflow temporário de transferência de objetos verificados por hash é retirado da árvore final; sua execução não é qualificação. Publicação somente na branch consolidada, sem força nem reescrita de histórico.
