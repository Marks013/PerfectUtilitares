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
