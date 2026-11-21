# Validade da sessão operacional e escopo de filiais

13/11/2026, clone isolado na base `c10602c246f3ec7a5f4bf64ae805cddf3cb960ce`. Implementação pura em `web/src/lib/escalas/operator-session-policy.ts` e `permission-scope.ts`, acompanhada de testes. Nenhum chamador do produto foi alterado.

## Estado de sessão confiável

`resolveEscalaOperatorSession` recebe projeções canônicas obtidas pelo servidor: empresa alvo, instante atual, política de acesso da empresa, registro de sessão e operador com vínculos atuais. O schema candidato desses campos foi preparado posteriormente no clone, mas nenhum banco foi migrado; a aplicação do SQL e os adaptadores continuam pendentes. Consulte `escalas-access-persistence.md`.

O adaptador futuro deve primeiro verificar integridade do cookie pelo mecanismo existente, localizar a sessão pelo hash do token e carregar política/operador/vínculos da empresa correta. Nome, ID, versão, papel ou grants enviados pelo navegador não podem construir esses registros. A função não valida token, não consulta banco e não autentica o nome.

A resolução exige:

- Política atual, com empresa correspondente e versão inteira positiva; modo exatamente `SCOPED`.
- Sessão vinculada ao operador correto, na mesma empresa; registros legados sem vínculo não recebem um usuário inferido.
- Ausência de revogação; qualquer valor de revogação fecha o acesso.
- Datas válidas: criação não futura, expiração posterior à criação e estritamente posterior ao instante da consulta. No instante exato do vencimento a sessão já está expirada.
- Operador existente, ativo e da empresa esperada.
- Versão de permissões da sessão igual à versão atual do operador e versão de política igual à política atual da empresa. Versões ausentes, fracionárias, negativas, zero ou fora de inteiro seguro são negadas.

O resultado `resolved` contém um principal exclusivamente operacional, ID de sessão, versões e expiração numérica. Copia e congela os vínculos e suas capacidades, sem copiar nomes, papel administrativo ou campos desnecessários. Esse resultado identifica um estado válido naquele instante; não autoriza automaticamente workspace, filial, importação ou relatório.

Uma identidade com vínculos vazios pode ser resolvida, mas recebe escopo `none` para operações de filial. A interface futura precisa explicar a ausência de acesso sem oferecer toda a empresa como alternativa.

## Escopo efetivo por capacidade

`resolveEscalaPermissionScope` usa a mesma matriz de permissões para devolver um resultado explícito:

| Resultado | Significado para o adaptador |
|---|---|
| `all` + empresa | ADMIN ativo autorizado à capacidade naquela empresa; a consulta continua limitada ao tenant. |
| `branches` + empresa/lista | Consultar somente as filiais canônicas da lista para a capacidade pedida. |
| `none` | Não retornar recursos nem executar mutações. Nunca interpretar como todas as filiais. |

O escopo é calculado separadamente para cada ação. Uma conta VIEWER pode consultar uma filial onde não pode salvar; APPROVER publica somente onde possui esse vínculo. Um operador que perdeu o download pode continuar com leitura se o grant atual assim definir.

O agrupamento percorre os vínculos uma vez, descarta empresa/pessoa diferentes, marca duplicidades canônicas como ambíguas e aplica a matriz aos vínculos únicos. Não escolhe o grant mais privilegiado. A saída é ordenada e imutável. Modos inválidos, identidade bloqueada e capacidades desconhecidas falham antes de percorrer os vínculos. Não há cache local de permissão.

## Integração ainda obrigatória

1. Persistir operador, vínculos, versões e modo por migração aditiva; não converter sessões legadas automaticamente. Validar shape e integridade dos registros na fronteira de persistência.
2. Resolver a conta geral primeiro e preservar sua precedência, inclusive quando bloqueada ou sem permissão. `null` no seletor significa conta ausente; não usar `null` para esconder erro ou bloqueio e permitir fallback operacional.
3. Aplicar `ADMIN_ONLY` também às contas gerais não administrativas. O resolvedor deste arquivo trata apenas operadores; o piso global de recuperação ainda depende da integração comum de acesso.
4. Incrementar versões e revogar sessões por transação administrativa em renomeação, bloqueio ou mudança de grants/modo. A função observa o estado recebido; não realiza essas escritas nem impede leitura inconsistente de consultas separadas.
5. Carregar estado consistente e revalidar antes de expor resultado, aplicar proposta ou persistir mutação. Um cálculo iniciado com acesso não conserva autorização depois de revogação. A concorrência real e a transação de gravação ainda precisam de testes de integração; uma fotografia imutável não resolve essa corrida sozinha.
6. Autorizar o recurso e seus campos conforme `route-policy.ts`, mantendo origem/CSRF, limites, revisão/CAS, propriedade de jobs e projeção de exportação antes do cache.

`ADMIN_ONLY`, `LEGACY` e modo desconhecido são negados ao operador pelo novo resolvedor. Isso ainda não altera a sessão compartilhada atual nem prova que a imagem antiga conhece o novo piso de recuperação. A ativação só pode ocorrer quando todas as rotas e contas legadas forem protegidas e o retorno seguro estiver validado.

## Verificação

Testes sintéticos cobrem resolução válida, empresa/identidade divergentes, expiração no limite, revogação, versões antigas, datas inválidas, snapshots imutáveis, estado atualizado, composição com precedência e escopo por capacidade. Não acessam servidor, banco, cookie real ou Solver. A prova de revogação aqui é sobre os registros fornecidos à função; não é uma simulação de job real ou migração aplicada.

Resultado local: 24 testes novos aprovados; conjunto com as etapas anteriores, 68 testes aprovados em cinco arquivos. Lint e TypeScript estrito aprovados. O último ajuste de retorno antecipado foi seguido por nova execução dos 24 testes afetados e checks estáticos. Revisão independente aprovada sem defeito concreto ou lacuna bloqueante para este corte puro; o revisor também confirmou as correções anteriores de VALIDATE e Unicode.
