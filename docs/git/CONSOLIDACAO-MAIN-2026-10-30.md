# Consolidação da main — 30/10/2026

O servidor `/home/ubuntu/PerfectUtilitares` é a fonte única autorizada. A `main` remota deve espelhar esse estado. Nenhum arquivo do checkout local foi importado.

Foram preservadas tags de arquivo para todas as pontas históricas abaixo. Commits já ancestrais não foram reaplicados; o único histórico não ancestral tinha patch equivalente já integrado. Foi criada uma junção por estratégia `ours`, sem alteração de arquivos. O GitHub recusou esse merge pela regra de histórico linear; a recuperação autorizada está descrita abaixo. Não houve reset nem force push.

| Origem | Branch histórica | Commit | Tag de recuperação |
| --- | --- | --- | --- |
| local | feat/reajuste-access-ui | 926e2a06ec5ae6ef9aa15b8afc141b7d4aedde7f | archive/2026-10-30/local/feat/reajuste-access-ui |
| local | feat/reajuste-salarial-pdf | 4bcafe187cd3f37751e81c7333700ca967510f0f | archive/2026-10-30/local/feat/reajuste-salarial-pdf |
| origin | Marks013-patch-1 | 6a1c1eb83107ed9b2328e370106708b0cc58d67c | archive/2026-10-30/origin/Marks013-patch-1 |
| origin | Marks013-patch-2 | 0d80eb6735288558102ff93defa3cc4ca7bf6f32 | archive/2026-10-30/origin/Marks013-patch-2 |
| origin | chore/biome-safe-fixes | 78c4481a56f747d439789ddae67cc3a7b78e04fd | archive/2026-10-30/origin/chore/biome-safe-fixes |
| origin | fix/prisma-migrate-readonly | 3a40ebdec1cb69dd1a859b19df1d88e52d935646 | archive/2026-10-30/origin/fix/prisma-migrate-readonly |
| origin | fix/remove-env-runtime-image | d327aafeb943008df5b815d65ef136fc9dc253f7 | archive/2026-10-30/origin/fix/remove-env-runtime-image |
| origin | fix/unimed-automatic-operator-name | 8d84b1a91bf339223f82bf3b594e1a617aa83388 | archive/2026-10-30/origin/fix/unimed-automatic-operator-name |
| origin | fix/unimed-pdf-calculo-email-competencias | 9fd746c6e395d055d62003062d4205293f679171 | archive/2026-10-30/origin/fix/unimed-pdf-calculo-email-competencias |
| origin | fix/unimed-v4-historico-smtp | e314a1ffa2f99479a701104fe9ef44b136646171 | archive/2026-10-30/origin/fix/unimed-v4-historico-smtp |

Revisão após consolidação histórica: `6d359e9cb4d1d1f50461c54513616c7f955d06a4`. Árvore preservada: sim.

As referências de branch só serão removidas após confirmar o push da main e de todas as tags de recuperação. As tags não são branches ativas: preservam os commits para recuperação. O resultado remoto final será registrado no fechamento de implantação.


## Recuperação autorizada do histórico linear

O push atômico inicial foi recusado por GH006, sem alterar nenhuma referência remota. O usuário autorizou linearizar somente os três commits locais não publicados após a implementação, preservando os originais.

- Backup anotado: archive/2026-10-30/server-before-linearization, apontando para06658e269e41b997a04616003203d11a45504333. Ele preserva também a revisão7d1dad9 usada pelas imagens em produção e o merge6d359e9.
- A implementação0eb884b e todo o histórico anterior foram mantidos. O merge deixou de integrar a ancestralidade da main, e os dois commits documentais posteriores foram reaplicados linearmente.
- Ponta linear antes desta atualização documental:7fb677b23fb6515da7087ebcf2d203e7a1c7e1a6.
- Árvore antes/depois:2501a1e5ff82b49efeb99be4b32f3240ddc9b263, idêntica. Nenhum código ou serviço de produção mudou.
- Zero merge commit no intervalo de publicação origin/main..HEAD. Não foram alteradas proteções do GitHub nem reescrito histórico remoto.

O histórico exclusivo de fix/unimed-automatic-operator-name permanece recuperável por sua tag de arquivo. Seu patch já está integrado de forma equivalente; não será reimportado para satisfazer ancestralidade artificial. A remoção dessa referência requer comprovar equivalência e preservação da tag no remoto.
