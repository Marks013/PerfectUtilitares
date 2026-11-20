# Benchmark do solver: baseline compatível (20/11/2026)

O benchmark compara soluções somente quando ambas passam pelo **mesmo validador independente**. A antiga revisão `ee815cd26fd8c6557f3228482338338d8288e91f` não cumpre as regras atuais de sábado e foi rejeitada com `SATURDAY_REST_FORBIDDEN` na execução sintética `44794083966`. Não é correto ignorar esse erro para declarar ganho de velocidade.

A referência histórica foi atualizada para o commit `2657f4a6894d01df58db9e3353f3ff7421047fc1`, já sujeito à convenção domingo–sábado, folgas explícitas e validação independente. Essa revisão é apenas um **baseline metodológico compatível**. Como o código Python do solver pode ser igual à revisão candidata em determinadas etapas, não se deve interpretar a comparação como avanço de desempenho.

O workflow `.github/workflows/escalas-synthetic-benchmark.yml` usa exclusivamente equipes sintéticas, verifica os calendários com Vitest, executa cinco repetições por versão em contêiner sem rede, CPU e RAM limitadas, registra p50/p95, RSS, déficits e erros. Uma falha do verificador faz a medição falhar. Resultados são específicos do runner ARM e não representam tempo de geração no servidor produtivo.

Para medir melhorias reais, compare revisões compatíveis com fontes distintas, mantendo mesmas restrições, hardware, horizonte, quantidade de pessoas e todas as métricas. Não utilize dados identificáveis de RH em artifacts públicos.
