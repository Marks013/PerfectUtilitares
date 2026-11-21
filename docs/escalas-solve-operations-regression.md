# Regressões de acesso e ciclo de vida das operações de geração

Tarefa `AUX-SOLVE-OPERATIONS-REGRESSION`, revisão 1, despacho `AUX-SOLVE-OPERATIONS-REGRESSION:r1:batch355`. Gate355 `a829eb386eb9741788a95bc98c519950a7d9ffeab556040d54be87d55ca5bf01`, reserva356. Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

**As quatro lacunas de cobertura foram fechadas no arquivo alvo: 25 testes aprovados, incluindo nove novos casos. Nenhuma falha de produto foi reproduzida.** O módulo de operações, a autorização e o resolvedor de sessão são reais; persistência, transação, serviço de geração e transporte externo são simulados. Esta entrega não altera o algoritmo Solver nem o código de produto.

## Contrato e plano anterior às edições

Foram lidos o relatório/manifesto privados de CF-SCOPE01 e os cinco documentos de contrato/revisão indicados no despacho. O relatório de escopo tem SHA-256 `5bf84f2516d8344b639581a7101a4e99f0383ce479421d11ed25edb0e5f263b9`; o manifesto tem `e46f7c3b3acebaf9f494d91b5856116a0a9f7db09fedc55e23e0b9aa099c3c5c`.

`escalas-access-functional.md:10–16` exige autoridade atual por operação e permite gerar uma prévia sem conceder salvar/aplicar. `escalas-access-api-contract.md:43–45` distingue SAVE da aplicação e vincula a proposta à autoridade/sessão vigente. A auditoria CF-SCOPE01 identifica quatro lacunas específicas no wrapper de jobs. A classificação anterior do delta como acesso/lifecycle permanece; não foi reaberta a autoria do Solver.

O plano foi preservar os 16 casos existentes, usar o acesso real e acrescentar apenas: sucesso com concessão exclusiva de gerar; mudanças durante espera do lock inicial; revogação em fronteiras assíncronas da entrega; seleção de limpeza/consulta por proprietário. Uma falha legítima seria mantida como reprodução e relatada, sem correção silenciosa do produto.

## Casos acrescentados

| Grupo | Novos casos | Resultado observável |
| --- | ---: | --- |
| Gerar sem SAVE | 2 | A sessão possui somente `workspace.read` e `schedule.generate`; o guard real nega salvar e aplicar. O workspace simulado informa `canEdit:false`. START/STATUS e geração com retorno de prévia passam; a variante de cancelamento também passa sem chamar o serviço de geração. |
| Espera do lock inicial | 3 | Uma barreira assíncrona suspende a aquisição simulada do lock. Enquanto aguarda, revoga-se a sessão, avança-se a versão da política ou muda-se a revisão persistida de 1 para 2. Depois da liberação, os dois primeiros recebem `401 ESCALA_ACCESS_REQUIRED` e o terceiro `409 ESCALA_REVISION_CONFLICT`; não há criação, contagem de reserva nem geração. |
| Revogação antes da entrega | 3 | A execução é suspensa durante o processamento simulado, depois da gravação simulada de COMPLETED ou durante a leitura terminal da operação. A sessão é revogada antes de liberar a barreira. Nenhum resultado é entregue; retorno, STATUS e CANCEL recebem 401. |
| Limpeza/consulta por proprietário | 1 | O armazenamento simulado contém operações próprias e de outro ownerKey, inclusive linhas antigas terminais e ativas, além de outro tenant com o mesmo ownerKey. A limpeza expira/remove somente as próprias. As demais permanecem idênticas, STATUS/CANCEL do proprietário errado retornam 404 e nenhum cancelamento externo ocorre. |

As barreiras permitem alterar o estado enquanto uma dependência está realmente aguardada pelo módulo. Não são timers nem uma sequência artificial de respostas de autorização. A fixture de revisão reconhece consultas sem filtro de revisão, de modo que retirar o CAS não produz uma negativa falsa no mock. A fixture de limpeza filtra várias linhas por critérios, em vez de devolver previamente o conjunto esperado.

A conclusão COMPLETED nas três negativas de entrega é apenas metadado da operação. Os testes não exigem um rollback inexistente nem tratam esse estado como autorização para revelar a proposta. O último guard do wrapper é a fronteira exercitada. O payload e a prova sintéticos devolvidos pelo serviço substituído não certificam conteúdo, HMAC ou viabilidade de escala.

## Cobertura existente reaproveitada

`web/src/lib/escalas/service.test.ts:1234–1241` já cobre geração exclusiva e negativa de SAVE/APPLY no serviço, e `:1254–1260` cobre revogação durante cálculo com ausência de escrita de workspace/revisão. Bytes lidos desse arquivo: SHA-256 `750f30e4f1736f8c7a87556138568da3b190e6f353bf2597210823f7afeb2717`. Esses casos foram lidos, não reexecutados, e não substituem a cobertura nova do wrapper. Não foram duplicados testes de prova criptográfica, cálculo ou aplicação.

Os 16 casos anteriores de identidade, tenant/sessão, autorização de STATUS/CANCEL, revisão, cancelamento, expiração e CAS tardio foram preservados e passaram junto dos nove novos. Resultados históricos de 450 ou 127 testes não foram reutilizados como evidência desta entrega.

## Isolamento e verificações

O Context Mode foi descoberto e validado por uma análise útil em `ctx_execute`; `ctx_search` foi usado para continuidade. Escritas foram feitas por ferramentas nativas. Não houve subagentes ou mensagens laterais.

As quatro configurações históricas de `outputs/escalas-account-save-regression/` foram somente lidas, após comunicar seus caminhos e receber o esclarecimento do coordenador. O script histórico e a suíte ampla não foram executados. A configuração adaptada ficou no temporário próprio e selecionou exclusivamente `src/lib/escalas/solve-operations.test.ts`, com um worker em thread, sem watch, cobertura ou servidor HTTP. Cache, geração temporária de configuração e a API de temporários do processo de verificação apontam para a pasta própria; variáveis globais TEMP/TMP foram preservadas.

A guarda Node é carregada antes do Vitest e herdada pelo worker. Bloqueia conexão/servidor/rede, subprocessos, leitura de `.env`/Prisma real e operações de escrita fora da pasta própria. Um autoteste separado tentou sete ações proibidas e confirmou sete recusas antes do I/O. Ele não integra nem aumenta a contagem dos 25 casos Vitest.

Na execução final, o processo principal registrou **uma tentativa bloqueada**: o Vite tentou executar `net use` para otimizar a resolução de caminhos no Windows. O comando não foi executado. O worker registrou zero tentativas proibidas e zero escritas. O principal registrou quatro operações de escrita permitidas no temporário e nenhuma tentativa de escrita externa. Os contadores completos e stacks estão nas evidências; não se alega zero tentativas globais.

| Verificação focal | Resultado |
| --- | --- |
| Vitest 4.1.12, somente arquivo alvo | 25 aprovados, zero falhas, zero ignorados; exit 0 |
| Autoteste da guarda | 7/7 recusas esperadas; exit 0 |
| Biome, somente teste alterado | Zero erros/avisos, nenhuma correção automática; exit 0 |
| TypeScript 7.0.2, raiz apenas no teste | `--noEmit`, incremental desabilitado, sem geração; exit 0 |
| `git diff --check` do teste | Aprovado |
| SHA-256 do produto na entrada e após cada checagem | Idêntico ao hash autorizado |

Biome e TypeScript instalados são executáveis nativos; foram chamados diretamente em modo estático, respectivamente sem escrita e com `--noEmit`. A guarda Node não instrumenta o interior desses binários, e não se afirma isolamento de sistema operacional para eles. Eles não executam o código de aplicação. A primeira tentativa pelo wrapper Node do TypeScript foi corretamente bloqueada por tentar lançar o compilador; a verificação final usa o binário local explicitamente, sem instalar ou executar lifecycle.

## Integridade, entrega e próximos passos

`solve-operations.ts` antes/depois: `1ff0db2008e4c301140b92b14988292f76edb79637a2f5490fb0eb07c1a3b611`.

O teste já tinha alterações anteriores ao despacho. Seu hash de entrada era `950f745f3bc4a2bb98c04ba05442a342645f4a1531e8b7332067d0f8da2e392d`. Foram acrescentadas as regressões e apenas as adaptações de fixture necessárias, preservando o restante. O manifesto fixa os bytes finais do teste, do produto e das evidências. O empacotador precisa incorporar a versão final de `solve-operations.test.ts` e atualizar seu manifesto; esta tarefa não altera o pacote congelado ou a fonte Central.

Comandos, saídas, configurações utilizadas, guarda, contadores e hashes ficam em `outputs/escalas-solve-operations-regression/`. Os scripts arquivados são evidência de execução, com caminhos do temporário desta tarefa; uma reprodução deve criar sua própria pasta antes de adaptar esses caminhos.

Não foram executados E2E, serviços, navegador, API real, PostgreSQL, Prisma real/generate/migrate, Docker, Python, Solver, quality, build, instalação, commit, push ou deploy. A transação simulada não demonstra locks PostgreSQL, concorrência entre clientes reais, rollback, visibilidade após espera ou triggers. Os próximos passos são revisão/empacotamento desses bytes e, em reserva própria, a validação integrada já pendente. Nenhuma alteração de produto adicional é recomendada pelo resultado desta seleção.
