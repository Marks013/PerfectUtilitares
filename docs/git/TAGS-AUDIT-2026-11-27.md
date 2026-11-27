# Auditoria de tags e referências — 27/11/2026

## Estado verificado

Foram conferidas as referências remotas, os objetos anotados, a correspondência entre o nome interno e o nome da tag, os commits de destino, a ancestralidade com histórico Git completo e as referências documentais. Nenhuma decisão de ancestralidade foi tomada a partir de clone raso.

- 11 tags de arquivo válidas, com 11 commits de destino diferentes.
- Zero referência quebrada, nome inválido ou destino duplicado.
- Nenhuma release retornada pela API autenticada do repositório.
- Nove destinos são ancestrais tanto de `main` quanto da branch consolidada do SolverForge.
- Dois destinos preservam histórico intencionalmente fora dessa ancestralidade.
- As 11 tags são anotadas, mas não contêm assinatura criptográfica. Isso não invalida os arquivos históricos; também não constitui prova de identidade ou certificação de versão.

A main conferida é `f78c691edbeaf16283f534bcacd8db1b4b7d5e66`. A branch consolidada estava em `074d299a5bfa02c02df6d003f44cc2f973bd217c`, cuja árvore corresponde ao código de `ed9099a`, após a retirada do workflow temporário de limpeza.

## Inventário e decisão

| Tag | Commit de destino | Classificação |
| --- | --- | --- |
| `archive/2026-10-30/local/feat/reajuste-access-ui` | `926e2a06ec5a` | Ancestral de main e consolidada |
| `archive/2026-10-30/local/feat/reajuste-salarial-pdf` | `4bcafe187cd3` | Ancestral de main e consolidada |
| `archive/2026-10-30/origin/Marks013-patch-1` | `6a1c1eb83107` | Ancestral de main e consolidada |
| `archive/2026-10-30/origin/Marks013-patch-2` | `0d80eb673528` | Ancestral de main e consolidada |
| `archive/2026-10-30/origin/chore/biome-safe-fixes` | `78c4481a56f7` | Ancestral de main e consolidada |
| `archive/2026-10-30/origin/fix/prisma-migrate-readonly` | `3a40ebdec1cb` | Ancestral de main e consolidada |
| `archive/2026-10-30/origin/fix/remove-env-runtime-image` | `d327aafeb943` | Ancestral de main e consolidada |
| `archive/2026-10-30/origin/fix/unimed-automatic-operator-name` | `8d84b1a91bf3` | Histórico de recuperação fora da ancestralidade atual |
| `archive/2026-10-30/origin/fix/unimed-pdf-calculo-email-competencias` | `9fd746c6e395` | Ancestral de main e consolidada |
| `archive/2026-10-30/origin/fix/unimed-v4-historico-smtp` | `e314a1ffa2f9` | Ancestral de main e consolidada |
| `archive/2026-10-30/server-before-linearization` | `06658e269e41` | Histórico de recuperação fora da ancestralidade atual |

**Decisão: preservar as 11 tags, sem recriação, deslocamento ou renomeação.** Não foram encontradas tags redundantes ou inválidas que justificassem exclusão. Todas são citadas em `CONSOLIDACAO-MAIN-2026-10-30.md`; remover os nomes quebraria a rastreabilidade documental mesmo quando o commit já pertence à main.

`origin/fix/unimed-automatic-operator-name` e `server-before-linearization` são particularmente importantes: preservam os commits fora da ancestralidade linear atual. O documento de 30/10 registra equivalência de patch no primeiro caso e uma revisão histórica de produção/junção anterior à linearização no segundo. Esta auditoria não reaplica esses commits nem confunde a revisão histórica com a versão atualmente implantada.

## Organização e uso futuro

O namespace `archive/AAAA-MM-DD/...` permanece reservado à recuperação histórica, separado de futuras tags de release. Novas versões publicadas devem ter nomes de versão inequívocos, commit identificado e evidências de qualificação correspondentes. Uma tag de versão não deve ser movida silenciosamente para corrigir uma publicação; uma nova versão deve preservar a anterior. A assinatura deve ser feita por identidade e chave autorizadas, não por identidade inventada nesta automação.

Não foi criada uma tag de release para SolverForge: a prontidão da migração e os benchmarks ampliados ainda estão pendentes. Não há alegação de redução de memória, tamanho do projeto ou latência do motor decorrente desta revisão de tags.

## Limpeza de branches e PRs

A limpeza autorizada retirou dez branches remotas antigas, incluindo as linhas Timefold, a antiga branch do PR #75 e a cópia anterior de hardening. Os PRs #74 e #75 foram fechados sem merge; suas discussões e evidências permanecem no histórico do GitHub. Somente `main` e `experiment/solverforge-consolidado-2026-11-26` permanecem como branches. O nome com final `2026-11-2026` informado na solicitação não existia; foi preservado o nome consolidado efetivo.

Execução de limpeza: `46053093762`. O workflow de uso único foi removido em `074d299`. Nenhuma proteção de branch, tag ou release foi relaxada. Não houve mudança da main, merge, deploy ou acesso ao servidor de produção.
