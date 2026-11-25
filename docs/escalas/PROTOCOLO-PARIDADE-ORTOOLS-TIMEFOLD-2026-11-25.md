# Protocolo de paridade dos dados e métricas existentes: OR-Tools × Timefold

Estado: PLANEJAMENTO. Nenhum benchmarking com dados reais executado, nenhum serviço produtivo parado, nenhum dado exportado. Em 25/11/2026, a referência da aplicação auditada é o commit main f78c691edbeaf16283f534bcacd8db1b4b7d5e66. Revalidar main antes dos experimentos.

Objetivo: reutilizar os mesmos dados, configurações, verificadores e indicadores do PerfectUtilitares como "régua" externa dos dois motores. Não comparar score Timefold contra objetivo CP-SAT, pois escalas numéricas não são equivalentes. Não reescrever as métricas independentes em Java como critério de aprovação.

## 1. Reutilizar o que já existe no projeto

| Ativo existente | Papel no comparador cross-engine | Restrição |
| --- | --- | --- |
| web/src/lib/escalas/types.ts e schema.ts | Contrato de entrada schemaVersion=1, políticas, colaboradores, turnos, demanda e assignments | DTO compartilhado. Mesma entrada original para as duas variantes, sem reformular o cenário entre execuções |
| web/src/lib/escalas/generation.ts e preparation | Preparar a mesma entrada legal/operacional antes de enviar para ambos | Preparar uma vez por cenário, versionar o hash canônico da entrada, não executar preparação independente por motor |
| web/scripts/escalas/benchmark-synthetic.ts:syntheticInput | Fixtures 10/1, 50/4, 115/6 e 115/6 com líderes sem relógio | Reutilizar função, expandir até 250/6 e testes de grupos por cargo, manual override, overnight; fixture sintética sem dados reais |
| web/scripts/escalas/benchmark-metrics.ts:independentShortage | Pessoas-minutos faltantes e desfalques agregados por setor nas demandas estimadas | Este método conta apenas demandas estimated=true; NÃO é auditoria completa de cobertura confirmada/protegida |
| web/scripts/escalas/benchmark-metrics.ts:weekendMetrics | Dispersão de taxas de sábado/domingo por coortes, incluindo histórico e ocupação civil | Mesmos denominadores e conjunto de colaboradores comparáveis nos dois motores |
| web/src/lib/escalas/sunday-sector-observations.ts | Distribuição de trabalho/folgas por setor, dia e serviço conhecido | Métricas observacionais, não autorização implícita de mínimo |
| web/src/lib/escalas/validation.ts:validateEscala | Verificação independente de jornada/descanso/restrições do resultado | Rejeitar erros ERROR antes de avaliar desempenho |
| web/src/lib/escalas/roster-quality.ts | Cobertura efetiva, comparabilidade do cenário, completude, preservação das referências e riscos por faixa | Executar mesmos guards por setor, cargo, hora, mês, domingo e referência publicada, não apenas somar desfalques |
| web/src/lib/escalas/coverage-protection.ts | FrozenCoverageService, janelas explícitas de serviço protegido | Distinto das demandas estimated. Nunca substituir proteção por objetivo soft |
| web/scripts/escalas/verify-model.mjs | Geração de casos semânticos positivos e negativos usando fixture dos testes | Conservar os dados semânticos, independentemente do backend; adaptar o executor, não a verdade jurídica |
| web/scripts/escalas/benchmark-real.ts | Entrada importada FPRE136 e afastamentos FPHI105, quando houver autorização adequada | Já aplica pseudônimos a algumas colunas, mas NÃO garante anonimização irreversível: horários, cargos, setor, ausências e histórico podem reidentificar pessoas |
| docs/performance/MEASUREMENT_PROTOCOL.md e DOMINGOS_POR_SETOR_INSTRUMENTACAO_2026-11-20.md | Padrão de telemetria e qualidade do projeto | Reusar dimensões, revisar baseline e limiares para o cenário atual |
| web/scripts/escalas/verify-synthetic-metrics.py | Verificação do registro da versão antiga: amostras, hash, imagem e métricas | Hoje é restrito a baseline/corrected Python; criar verificador cross-engine sem modificar indevidamente o contrato antigo |

## 2. Problema do benchmark atual que deve ser corrigido no novo harness

O script benchmark-runtime.ts fixa BASELINE_REVISION=2657f4a6894d01df58db9e3353f3ff7421047fc1, um baseline histórico da versão de 20/11. O main auditado em 25/11 está no SHA f78c691edbeaf16283f534bcacd8db1b4b7d5e66 e contém várias correções posteriores.

Não é lícito comparar um Timefold baseado no contrato atual a um CP-SAT historicamente desatualizado e chamar isso de evolução. A referência OR-Tools do teste deve ser um build imutável da mesma main atual que origina as fixtures, junto com seu hash/artefato de imagem. Não modificar silenciosamente a constante histórica do script de acompanhamento antigo: usar nova referência versionada específica do comparador cross-engine, com origem registrada.

O benchmarkPython injeta fontes Python num subprocesso Docker. Um Java JAR não pode compartilhar essa instrumentação sem adaptação. Criar novo orquestrador de testes que emita o MESMO tipo de registro normalizado para ambas as variantes e rode o MESMO validador TypeScript. A implementação do motor/score é diferente; a semântica do input/output permanece a mesma.

## 3. Identidade imutável da entrada

Por cenário, derivar UMA EscalaInput pré-processada. Registrar sem gravar PII:
- scenarioId e nome de fixture sem informação pessoal;
- schemaVersion, generationMode, planningWeekStartsOn, restRulesVersion, timeZone e tamanho da semana;
- contagem de pessoas por TIMED/UNTIMED/MISSING/excluídas, turnos, demandas estimated/confirmed, bloqueios, feriados, dias e histórico;
- hash criptográfico de conteúdo canônico da entrada, com salt/segredo não divulgado se houver campos pessoais (não publicar hash identificável de pequeno espaço);
- hash do validador/metric evaluator TypeScript, Git SHA exato da main, digest da imagem OR-Tools, digest da imagem/JAR Timefold, Java runtime e versão Timefold;
- versão de policy-reference.json e do schema, flags de geração e pesos/ScoreConfig Timefold.

A mesma fixture deve receber o MESMO identificador de cenário de referência e a MESMA configuração de negócio para ambos. Não confundir uma alteração de regra na main com ganho de algoritmo.

## 4. Regras de execução sequencial para proteger a A1 compartilhada

- Nunca executar OR-Tools benchmark e Timefold benchmark ao mesmo tempo. Primeiro Docker descartável do OR-Tools, encerrar e garantir limpeza, depois Docker descartável do Timefold, alternando a ordem A/B e B/A entre blocos.
- Não parar, nem alterar limite, nem reiniciar o serviço produtivo escalas-solver. A instância produtiva usa /solve e /cancel e precisa estar disponível para seus usuários.
- Preferir runner CI Linux ARM64 isolado; testes no host Oracle A1 somente com autorização e baseline de carga de outros projetos, pressão do host admissível e limite cgroup conservador.
- Mesmos limites do container por variante (CPU, memória, PIDs, network=none, runtime read-only), distinguindo tempo de startup, parsing, preparação, tempo de primeira solução hard-válida, busca ativa e validação pós-resposta.
- Rodar Quarkus Timefold em JVM production mode e JIT aquecido para testes de busca; medir também cold start separadamente. O warmup não conta na métrica de busca, mas conta na latência fim-a-fim de ativação.
- Sob pressão ou métricas indisponíveis, não iniciar o benchmarking no servidor compartilhado. Não montar Docker socket no app e não acessar banco/secret de produção.

## 5. Métricas unificadas dos dois motores

Categoria Segurança/validade (veto incondicional):
- status da resposta adaptado honestamente, completude, erro do validador TypeScript por código, modificação de ausências/feriados/locks/histórico publicado, compatibilidade dos modos REST_ONLY/HOURS_ONLY/DAYS_AND_HOURS, cobertura expressamente hard.
- Timefold não prova OPTIMAL/INFEASIBLE por timeout; reportar FEASIBLE somente se solução final completa e aceita, senão UNKNOWN/erro adequado.

Categoria Cobertura (veto por cenário):
- falta total estimada de pessoas-minutos, por setor, cargo e intervalo; faixas confirmadas e de serviço protegido; fechamento, abertura, domingos, prioridade de movimento, ausência de serviço conhecido.
- comparar diariamente e por subescopo de horizonte, mês visível, domingos e mês+domingos onde suportado pelo verificador. Nenhuma média total pode ocultar piora em faixa protegida.
- sempre comparar a mesma referência salva e o mesmo conjunto de demandas; o algoritmo pode produzir escalas diferentes, mas não redefinir o padrão de comparação.

Categoria Justiça/qualidade (após segurança e cobertura):
- dispersão de sábado/domingo entre grupos comparáveis, número de dias coletivamente OFF, domingo vazio por setor, dias com líder ausente, pares de folga, espaçamento, preferências, número de pessoas/dias alterados, estabilidade e qualidade da abertura de dezembro.
- usar weekendMetrics, sundaySectorObservations, restQuality/rosterQuality existentes. Score nativo Timefold é diagnóstico adicional, NÃO comparável numericamente com objetivo OR-Tools.

Categoria Desempenho (desde que resultados aceitos):
- sucesso dentro do prazo, tempo até primeira solução hard-válida e resposta final, mediana, p95/p99 com amostra adequada, CPU-segundos, RSS/cgroup peak, heap/GC, threads/PIDs, start frio/quente, contenção de fila, operações canceladas e host CPU/mem PSI.
- marcar separadamente TIMEOUT, INCOMPLETE, INVALID, UNKNOWN, ERROR e FEASIBLE. Não excluir falhas para produzir mediana artificialmente favorável.

## 6. Cobertura de cenários

Conjunto mínimo obrigatório: 1 pessoa/1 semana, 10/1, 50/4, 115/6, 115/6 com gestor UNTIMED (sem horário), 250/6; grupos de cargo/relógio diferentes no mesmo setor; casos com histórico e planningFuture, sábados e domingos, fechamento, feriados com e sem autorização, 40/42/44h e transição, jornada mista, overnight, manualShiftByDate, importações FPRE136, ausências FPHI105, bloqueios, mês visível, planningWeekStartsOn MONDAY/SUNDAY e referências salvas.

Como 250/6 é o limite superior de entrada, medir memória e tempo até first-hard-feasible além da qualidade final. Não inventar demanda real onde só existe estimativa. Uma fixture artificialmente difícil deve indicar se a regressão é estrutural e não permitir publicação real.

## 7. Procedimento de aprovação

G0: fonte da main/regras mapeada e fixture + verificador com hash idêntico; G1: JVM/Quarkus/Timefold e Java AArch64 compilam; G2: 100% de validações hard; G3: contrato privado com auth/cancelamento; G4: nenhuma piora por faixa/scope protegido; G5: 250/6 e desempenho dentro do limite aprovado; G6: sem prejudicar outros projetos; G7: E2E isolado e rollback; G8: autorização específica para cutover.

Rodada exploratória: cinco repetições por variante/cenário, ordem alternada, triagem de bugs e revisão de métricas. Aceite final de qualidade: cinco ou mais sementes distintas com cinco ou mais repetições sob configuração estável, sem esconder variabilidade; latência/p95: pelo menos trinta execuções válidas ou falhas contabilizadas por cenário/configuração; cold starts: pelo menos trinta se scale-to-zero estiver em consideração.

Uma falha hard ou do validador independente reprova imediatamente; perda de cobertura protegida também. Não aceitar ganho de 115/6 para justificar regressão no 50/4, nem ganho de velocidade que reduza disponibilidade do outro projeto. Resultados inferiores precisam de análise e correção antes de propor implantação.

## 8. Dados reais do projeto atual: restrição de privacidade

O usuário autorizou usar dados e métricas do projeto atual como parâmetros. Isso inclui imediatamente CÓDIGO, CONFIGURAÇÕES e FIXTURES SINTÉTICAS existentes. Para registros pessoais reais de RH, exigir processamento local autorizado, minimização e revisão do procedimento; NÃO enviar CSVs FPRE136/FPHI105, nomes, matrículas, ausências, horários identificáveis ou payloads ao GitHub/CI público, ferramenta externa ou logs.

O modo benchmark-real.ts substitui identificadores, mas conserva horários, cargo, setor e histórico. Essa pseudonimização não equivale automaticamente a anonimização. Não usar material real neste PR documental. Para prova interna aprovada, usar fixture sanitizada e armazenada somente no ambiente controlado, com duração/escopo definidos e sem compromisso de copiar dados do servidor.

## 9. Arquivos propostos (não implementados neste PR)

- web/scripts/escalas/benchmark-cross-engine.ts: orquestrar preparação única, execuções sequenciais OR-Tools/Timefold e colheita de métricas. Sem acesso ao Compose produtivo.
- web/scripts/escalas/benchmark-cross-engine-verify.ts: validar hashes, status, flags, pareamento dos cenários, opções, invariantes e não regressões por subescopo.
- web/ops/escalas-timefold/: serviço Java de PoC com DTO e output equivalentes, sem acesso a banco.
- web/src/lib/escalas/*: reutilizar os validadores TS sem transportar regras para uma segunda implementação de métricas em Java.
- .github/workflows/timefold-cross-engine.yml: CI ARM64 isolado, só fixtures sintéticas, com upload de métricas agregadas e hashes. Sem apontar para serviço produtivo.

Fontes auditadas: benchmark-synthetic.ts, benchmark-real.ts, benchmark-runtime.ts, benchmark-metrics.ts, verify-model.mjs, verify-synthetic-metrics.py, roster-quality.ts, coverage-protection.ts, validation.ts e docs/performance/MEASUREMENT_PROTOCOL.md. O contrato atual precisa ser revalidado se main mudar.

Referências internas:
- https://github.com/Marks013/PerfectUtilitares/blob/main/web/scripts/escalas/benchmark-synthetic.ts
- https://github.com/Marks013/PerfectUtilitares/blob/main/web/scripts/escalas/benchmark-real.ts
- https://github.com/Marks013/PerfectUtilitares/blob/main/web/scripts/escalas/benchmark-metrics.ts
- https://github.com/Marks013/PerfectUtilitares/blob/main/docs/performance/MEASUREMENT_PROTOCOL.md
