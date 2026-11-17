# Resultado da CI da revisão do PR #35

Data da conferência: 17/11/2026.
Commit de código avaliado: `73c80ce84ded4d0b6e1d64aa5fbb209b68b733a4`.
Este documento complementa `escalas-calendar-pr35.md` e não altera código, testes,
configuração, dados ou critérios de aprovação.

## Resultados remotos observados

Execução de paridade: `44100813272` (`Planning calendar parity`), aprovada.
Execução geral: `44100813023`, ainda reprovada.

| Verificação | Resultado observado |
| --- | --- |
| Calendário Python/TypeScript e paridade | Aprovado |
| Construção das imagens e validação Compose | Aprovado |
| Regressões do solver Python | Aprovado |
| Verificação estática Python (Ruff) | Aprovado |
| Conferência independente dos resultados em TypeScript | Aprovado |
| Casos gerados de propriedades, conferidos independentemente | Aprovado |
| Job Code, dependencies and PostgreSQL | Reprovado em Run checks without a browser |
| Job Production build and browser flows | Não executado após a reprovação |

Identificadores dos jobs da execução geral: qualidade `134100003912`, imagens
`134100004332`, solver/verificador `134100004391`. Os resultados acima pertencem
à revisão de código 73c80ce, não a uma futura versão nem a uma implantação.

## Pendência de diagnóstico das falhas TypeScript

O log recuperado do job de qualidade reporta seis falhas TypeScript. Não foi
possível correlacionar com segurança todos os caminhos e casos reportados com
os arquivos recuperados no SHA 73c80ce. Por exemplo, o log referencia
`web/src/lib/escalas/fpre136-schedule.test.ts`, mas a consulta desse caminho no
mesmo SHA não encontrou o arquivo. O teste de classificação recuperado é
`web/src/lib/escalas/fpre136-classification.test.ts` e contém casos diferentes.
Também há divergência entre o caso/linha reportado para `solver-client.test.ts`
e o trecho recuperado desse arquivo no commit.

Isso não comprova a causa da divergência e não permite declarar os testes
aprovados ou atribuir as falhas a um defeito específico. É necessário reconciliar
o log com o checkout efetivamente executado e reproduzir as falhas antes de
alterar esses contratos. Não foram criados arquivos substitutos, desativados
casos ou enfraquecidas regras de elegibilidade, preservação ou cobertura para
contornar um diagnóstico ainda não confirmado.

## Estado de liberação

O PR permanece em rascunho e não está aprovado para implantação. Não houve merge
na main, deploy ou verificação do processo/banco do servidor de produção.
Construção de imagem em CI não é evidência de implantação nem de saúde do
ambiente em execução.

A regra domingo-sábado continua somente na fundação de calendário: a integração
com contratos de entrada, jornada, solver/sugestões, verificador, migração,
interface e exportações ainda não foi concluída. Os testes aprovados não
certificam uma funcionalidade que ainda não está conectada.

A liberação continua condicionada à integração restante, à resolução da CI
completa, ao procedimento de qualidade/release de AGENTS.md e à conferência dos
fluxos reais depois de uma implantação autorizada. O conteúdo de produção não
foi modificado nesta revisão.
