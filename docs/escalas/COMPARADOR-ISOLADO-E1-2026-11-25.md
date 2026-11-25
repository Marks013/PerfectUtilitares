# E1 — comparador isolado (primeira implementação experimental)

Base do motor e avaliador: f78c691edbeaf16283f534bcacd8db1b4b7d5e66. PR de planejamento #70. Este código não altera o aplicativo, o serviço produtivo, a API, o banco, a importação, o motor Python ou seus limites. Nenhum dado do CSV/PDF foi incluído. Não executar na A1 compartilhada; utilizar runner Linux ARM64 descartável, sem projetos produtivos.

## Execução
No checkout limpo da branch, com a toolchain do projeto, dependências do lockfile e Docker local. Construir a imagem a partir dos arquivos da main auditada (não usar tag de produção):
```sh
cd web
npm ci
npm exec -- vitest run src/lib/escalas/cross-engine.test.ts
# Verificar git diff e build somente num runner isolado.
BASE=f78c691edbeaf16283f534bcacd8db1b4b7d5e66
BUILD=$(mktemp -d)
git -C .. archive "$BASE" web/ops/escalas | tar -x -C "$BUILD"
docker build --target runtime --build-arg SOURCE_REVISION="$BASE" -t escalas-cross-engine-baseline:local "$BUILD/web/ops/escalas"
rm -rf "$BUILD"
IMAGE=$(docker image inspect escalas-cross-engine-baseline:local --format '{{.Id}}')
ESCALAS_CROSS_ENGINE_ISOLATED=1 node --conditions=react-server --import tsx scripts/escalas/cross-engine/cli.ts team-10-week 1 "$IMAGE"
```

O comando exige opt-in de runner isolado, checkout sem alterações rastreadas, fontes de app/solver iguais ao SHA base (exceto teste novo), ID de imagem imutável e label de revisão. O label não é prova criptográfica do conteúdo: build a partir de git archive e conservar digest/identidade do runner. Nenhuma entrada arbitrária, caminho de CSV ou workspace é aceito. Usar 5 repetições para exploração, 30 para triagem e 100 conforme protocolo final; 1 é apenas smoke. Cenários disponíveis: team-10-week, branch-50-four-weeks, branch-115-six-weeks, branch-115-six-weeks-untimed, december-representative, hours-reference-only, hours-only-with-grid, stress-250-six-weeks, december-protected (referência sintética admitida para testar o envelope, sem garantia de viabilidade). hours-reference-only dispensa motor. O caso dezembro é sintético, 140 cadastros, 125 operacionais, não cópia individual da filial. O modo HOURS_ONLY utiliza uma grade sintética, não dados reais.

## Contrato do candidato (futuro)
O quarto argumento opcional é o ID sha256 de uma imagem Timefold de teste com label org.opencontainers.image.revision = SHA do código. Seu entrypoint recebe exatamente um JSON de requestSolver no stdin, devolve somente um JSON no stdout: {httpStatus: 200, body: {status, assignments, message, wallTimeSeconds}, maxRssKiB: número ou null}. Erros usam HTTP status compatível e body objeto. Não simular OPTIMAL/INFEASIBLE; corpo <=8 MiB. Sem rede, sem Docker socket, read-only, uid 1001, 1 CPU, 1536 MiB, sem swap adicional, 64 PIDs. O baseline usa validate_model_input e Operations/run_operation do runtime fixado, sem carregar segredo real. Cada execução fria é um novo container, encerrado antes do próximo. A/B alternado; o helper de fetch intercepta toda comunicação, permite apenas URL fictícia .invalid e segredo aleatório temporário, restaura globals e descarta segredo.

O envelope é capturado uma vez pela chamada real ao cliente; cada repetição usa o mesmo payload byte a byte, falhando se mudar. O motor não recebe dados de referência privada que o produto não transporta. A chamada real solveEscala aplica validação, reparos/seleção e outcome. Métricas brutas são diagnósticas; não atribuir reparo TS ou referência retida ao motor. JSONL contém identidade, hashes sintéticos, estados, tempo frio, RSS quando disponível, validações e métricas agregadas; propostas só em memória. Falhas permanecem no denominador. O comparador não certifica superioridade: não mede HTTP real, warmup, cgroup/PSI/CPU-segundos, nem implementa todos os casos negativos e especiais/holdout. A captura exercita admittedDecemberOrigin em fixture específica; recuperação especial de 23s, seed externa, demais casos protegidos e seus oráculos precisam de extensão antes do gate G4/G5. Status OPTIMAL/INFEASIBLE do candidato Timefold são recusados neste adaptador. Resultado idêntico à referência é contado separadamente, não como nova escala. Não usar a simulação de /cancel como evidência de cancelamento HTTP. Não houve execução local nesta sessão (Docker/rede/dependências indisponíveis); os checks do PR são a fonte de evidência independente; o workflow dedicado executa apenas smoke sintético do baseline.


## Continuação E1: evidência e rodada exploratória

Smoke ARM64 do commit e6ea6d8: [45692778418](https://github.com/Marks013/PerfectUtilitares/actions/runs/45692778418). 10/1: FEASIBLE, 11,903 s reportados pelo motor, 12,706 s adapter, 12,735 s comparador, 114.728 KiB RSS filho, 1.512 pessoas-minutos de falta estimada, zero erros e proposta nova. 552 regressões Python e verificador independente passaram; paridade calendário e build Docker passaram. CI geral bloqueada pelo título test: em PR que inclui scripts/workflow/docs; título corrigido para chore:, sem alterar gate. Uma amostra não certifica p95 nem VM.

A rodada seguinte executa 5 repetições frias em 10/1, 50/4, 115/6, dezembro/31, HOURS_ONLY com grade e reparo com grade comum; 1 ensaio negativo de recuperação de presença (23/27/32s, locks preservados) e 1 stress 250/42; mais fluxo de referências sem grade. Total: 32 solves de baseline e um fluxo sem solve. O verificador Python independente valida contagem, índices, hashes/identidade, quotas, perfil do envelope, status e atribuição de ganhos; testa mutações. Falhas são registradas, não excluídas. A presença de pelo menos uma proposta válida por cenário positivo não é garantia de sucesso em todas as execuções. O stress e a recuperação bloqueada não exigem proposta nova. Sem p95/p99 final, nem warm JVM/cgroup. O novo perfil conta posições, referências de catálogo (não domínio exato), locks, bandas e prazos. A grade comum de reparo é sintética; a trilha de _initialAssignments externo e recuperação positiva ainda exige prova.


### Reprovação da segunda rodada e correção da fixture (25/11/2026)

O [workflow 45696358377](https://github.com/Marks013/PerfectUtilitares/actions/runs/45696358377) executou 32 medições no SHA ca224da, sem erros de validade nas 26 propostas viáveis. Resultados: 10/1 = 5/5; 50/4 = 5/5; 115/6 = 5/5; horários com grade = 5/5 (sem novidade); reparo = 5/5; stress 250/42 = 1/1; dezembro representativo = 0/5 INFEASIBLE; recuperação bloqueada = 0/1 HTTP 400 SOLVER_INVALID_INPUT. O verificador reprovou corretamente; não se declara benchmark aprovado.

Causas identificadas por confronto entre o código e os logs:
- Calendário MANUAL da fixture dezembro marcou Natal em closedDates e holidayDates, mas não em paidHolidayDates. applyLocalHolidayCalendar retorna o input intacto no modo manual. hints.paid_holiday_dates exige explicitamente os três conjuntos; solver.py então exigia WORK ou OFF nesse dia, proibia WORK por fechamento e OFF por feriado. Corrigido o dado sintético com paidHolidayDates=["2026-12-25"], preservando fechamento, FE, jornada e demais restrições.
- Recuperação bloqueada não declarava generationMode. Embora solveEscala trate ausência como DAYS_AND_HOURS no teste de elegibilidade, validate_model_input exige esse campo explícito para _restPairTarget=20. Corrigido apenas o envelope sintético; não alterada a API.

Novo preflight: cada cenário medido passa pelo validate_model_input real na mesma imagem imutável e com os mesmos recursos, antes da rodada; cada execução também valida o envelope congelado exato antes do cronômetro. O preflight não é prova de viabilidade. Rejeições expõem apenas códigos/famílias e campos de schema filtrados, nunca valores/payloads. O controle negativo exige resposta real do solver (200 e status conhecido, não 400), preserva todos os locks e não contabiliza proposta nova. Testes novos cobrem campos e rejeições; o verificador agora informa código fixo e cenário quando não há solução válida. Nenhum limite de negócio, deadline, quota ou gate positivo foi relaxado. A nova rodada mantém 32 medições e deve comprovar a correção; não foi executada nesta revisão.
