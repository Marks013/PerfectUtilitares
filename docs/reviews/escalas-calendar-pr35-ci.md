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

## Histórico do diagnóstico inicial

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

## Diagnóstico reconciliado e reparos aceitos em 17/11/2026

O diagnóstico inicial acima é histórico e foi superado pela reprodução no
checkout do servidor. Foram identificadas 18 falhas em fixtures de testes que
ainda pressupunham jornadas de 6 horas, já excluídas pelo contrato vigente.
Os reparos ajustaram apenas essas fixtures e suas expectativas, sem relaxar
regras de produção. A validação focada registrou 85 testes aprovados em três
arquivos, incluindo cinco novas regressões, sem skips. Esse resultado não
substitui o quality completo nem altera retroativamente a execução remota citada.

Os ajustes de cores e invalidação de cache de exportação também foram aceitos
para integração. As evidências correspondentes pertencem às revisões de cada
frente; não certificam uma nova grade ou justiça final na distribuição de
oportunidades.

## Escopo autorizado e gates pendentes de execução

O usuário autorizou integrar a fundação da PR #35 e os reparos aceitos à main,
fazer push e implantar somente após os gates canônicos. No momento desta
atualização, o quality completo integrado e a implantação dessa revisão ainda
não foram executados nem aprovados. A execução final deve registrar revisão,
hashes, resultados, limitações e saúde real da produção em relatório próprio.
Construção de imagem em CI não é evidência de implantação ou de saúde do runtime.

A regra domingo-sábado continua somente na fundação de calendário: a integração
com contratos de entrada, jornada, solver/sugestões, verificador, migração,
interface e exportações ainda não foi concluída. Os testes aprovados não
certificam uma funcionalidade que ainda não está conectada.

A implantação autorizada abrange a fundação dormente e os reparos aceitos; não
depende de ativar a funcionalidade domingo-sábado completa. Sua ativação exige
outro escopo, integração e validação dos contratos restantes. Nesta liberação,
não gerar, recalcular, salvar, aplicar, publicar ou migrar grades; manter horários,
regras de 4h30/9h e opções manuais intactos. O procedimento de AGENTS.md exige
uma rodada real de quality completo sem filtros e, se aprovada, um único
docker:deploy com build, seguido de conferência dos fluxos públicos/autenticados.
Nenhum resultado futuro está antecipado por este documento.
