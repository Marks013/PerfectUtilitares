# Base isolada de permissões de Escalas

Primeira entrega local do planejamento de relatórios e acessos, autorizada em 13/11/2026 após avaliação independente de viabilidade. Clone separado de `main` em `c10602c246f3ec7a5f4bf64ae805cddf3cb960ce`, branch `codex/escalas-permissoes-isoladas`. Essa base ainda não contém o lote que o Maestro Central está integrando.

## O que está implementado

`web/src/lib/escalas/permissions.ts` contém decisões puras, sem Prisma, rede, sessão, geração ou renderizadores. As decisões exigem uma identidade já resolvida pelo servidor; nome digitado, cookie ou payload não são uma identidade confiável por si só.

- ADMIN ativo mantém todas as capacidades conhecidas dentro da própria empresa.
- A conta geral `OPERATOR` usa os papéis VIEWER/PLANNER/APPROVER de cada vínculo `EscalaBranchAccess`, como no schema atual; esses papéis não são globais do usuário.
- VIEWER conserva leitura e PDF/XLSX básicos; PLANNER conserva operações de grade e cadastros; APPROVER conserva publicação somente na filial com esse vínculo legado.
- O novo operador possui grants explícitos por empresa/pessoa/filial e uma lista de capacidades operacionais. Lista vazia não recebe permissões padrão. Revogação ou remoção é observada na próxima chamada com o estado atualizado.
- Importações, TXT/manifestos, análises, configurações, exclusão e gestão de acesso permanecem administrativos. Uma lista de capacidades adulterada não permite delegá-los ao operador. O operador novo também não publica.
- Códigos numéricos de filial seguem o normalizador existente. Vínculos ambíguos depois da normalização são negados, sem escolher o mais privilegiado.
- Conta geral tem precedência explícita sobre a identidade operacional, inclusive quando bloqueada ou sem vínculo. Não há união de cookies nem fallback para contornar uma conta sem acesso.
- `ADMIN_ONLY` nega todos os não administradores. `SCOPED` aplica a matriz. Modo ausente/desconhecido ou `LEGACY` não tem fallback neste módulo novo; o modo legado atual não foi conectado nem modificado.
- A projeção de exportação é resolvida depois da permissão de formato e filial: básica para não administradores, completa somente para ADMIN, com pedidos de formato/projeção desconhecidos negados.

O catálogo usa `settings.manage` como capacidade administrativa inicial. Delegação de grupos/campos de configuração não foi implementada: depende do inventário fechado dos campos e da comparação com estado canônico, prevista no plano. Não há delegação implícita dos limites de 4h/4h30, do misto 8h/9h ou de outros parâmetros.

## Identificação por nome

`operator-username.ts` prepara uma chave de consulta única para uso futuro tanto no cadastro administrativo quanto na entrada. Não consulta banco, cria usuário, emite cookie ou concede permissões. A futura unicidade será por empresa e chave normalizada; nunca uma busca global pelo nome.

A regra usa Unicode NFKC, remove espaços externos, reduz espaços entre palavras a um e ignora diferenças entre maiúsculas e minúsculas. Acentos e pontuação continuam significativos: `João` e `Joao` são nomes distintos. A chave aceita até 64 pontos de código após normalização e no máximo 256 unidades UTF-16 na entrada bruta, sem truncamento. Controles, formatação invisível, separadores de linha e Unicode malformado são rejeitados. Nome inválido retorna `null`; a interface futura deve usar erro genérico e não enumerar usuários.

Nomes que normalizem para a mesma chave devem gerar conflito no cadastro, não selecionar arbitrariamente uma pessoa. O nome `admin` continua sendo apenas um nome operacional; a conta administrativa mantém a autenticação atual. A escolha de nome permanece identificação para separar a navegação, conforme aceito pelo usuário, sem comprovar identidade pessoal.

## Limites deliberados desta entrega

O segundo avanço acrescenta `route-policy.ts` e seus testes, com a classificação das oito rotas atuais e das onze ações discriminadas de POST. O contrato separa capacidades fixas de verificações obrigatórias de recurso, revisão, campos, operações e projeção. Consulte [o contrato por rota](escalas-route-policy.md). Ele também permanece desconectado dos handlers.

O terceiro avanço acrescenta `operator-session-policy.ts` e `permission-scope.ts`, com seus testes. Confere validade de registros canônicos de sessão, revogação, versões e escopo de filiais por capacidade. Consulte [validade da sessão e escopo](escalas-session-scope.md). O banco não foi migrado e os adaptadores do produto continuam inalterados.

O quarto avanço prepara o schema candidato e o SQL de armazenamento de operadores, vínculos e modo/versionamento. O SQL fica fora de `prisma/migrations` para impedir aplicação automática nessa etapa incompleta. Consulte [persistência candidata e prova de migração](escalas-access-persistence.md). Nenhum registro ou tabela foi criado em banco; a alteração existe apenas no clone.

Nenhum chamador do produto foi alterado. Esta matriz não torna o login atual restrito, não cria usuários, não grava grants e não valida identidade, expiração, versão de sessão ou existência do recurso. Os adaptadores futuros devem fornecer uma identidade e vínculos atuais, obtidos do contexto canônico; o cliente nunca escolhe sua empresa, papel ou grants.

Autorizar uma ação não autoriza qualquer payload. As próximas etapas devem conferir campos operacionais, política aprovada da filial/período, locks, revisão, catálogo e limites do Solver nos serviços, além de aplicar os guards em todas as rotas e ações. A revogação durante jobs e a preservação do administrador exigem testes de integração reais.

`ADMIN_FULL` identifica permissão/projeção, não a obrigação de incluir toda análise em qualquer formato. Na integração, preservar a decisão nova: nenhuma aba Capacidade/Desfalques no XLSX, inclusive administrativo; manter análises autorizadas no PDF. Guard deve executar antes do cache, cuja chave deve conter a projeção efetiva e a versão do contrato. Esses renderizadores/caches ainda não foram modificados.

## Próxima base e condição de integração

Antes de alterar sessões, rotas, serviço ou relatórios, incorporar o commit integrado do Central contendo os reparos de calendário, comparação, Python, estabilidade individual e ordenação setor/cargo/horário/nome. Basta uma revisão integrada e identificável, com situação dos testes e arquivos liberados; não é necessário aguardar publicação das grades.

Reconciliar o plano original baseado em `fd4d376b` com esse novo commit. Os snapshots antigos são somente evidência de auditoria; novembro foi removido pelo usuário e não deve ser recriado. Não copiar ambientes, credenciais, banco, dados pessoais ou snapshots reais para este clone.

Esta entrega local não autoriza aplicar migração, ativar acesso, fazer commit/push, publicar ou implantar. Os gates completos do projeto pertencem à integração futura; os testes locais desta matriz não certificam a aplicação inteira.

## Verificação desta etapa

Verificação local em 13/11/2026, com Node 24.22.1 e dependências do lockfile instaladas por `npm ci --ignore-scripts --no-audit --no-fund`:

- Vitest 4.1.12: `permissions.test.ts`, 20 testes aprovados, inclusive caminhos permitidos, negações, isolamento e projeções.
- Biome: lint dos dois arquivos, sem erros ou avisos, com `--error-on-warnings`.
- TypeScript 7.0.2: verificação estrita dos dois arquivos e suas dependências de tipo, sem emissão, aprovada. Comando delimitado: `tsc --ignoreConfig --noEmit --strict --skipLibCheck --module ESNext --moduleResolution bundler --target ES2022 src/lib/escalas/permissions.ts src/lib/escalas/permissions.test.ts`.
- Revisão independente somente leitura: aprovada para o corte puro, sem defeito concreto ou lacuna bloqueante. Depois da revisão, foram ajustados apenas encadeamentos opcionais e a nulabilidade do helper de teste para atender ao lint; os 20 testes e os checks estáticos passaram novamente.
- O remoto `main` foi consultado novamente ao finalizar os checks e permanecia em `c10602c246f3ec7a5f4bf64ae805cddf3cb960ce`.

Nenhum teste acessou servidor, banco ou Solver. Não foram executados o quality completo, build, Compose ou E2E da aplicação: são gates da integração futura, e esta matriz não possui chamadores no produto. Os resultados acima não certificam o login, as rotas, a persistência, os arquivos exportados ou a aplicação inteira.

Segundo avanço, ainda em 13/11/2026: 44 testes aprovados em três arquivos (`permissions`, `operator-username` e `route-policy`), lint dos seis arquivos sem avisos e TypeScript estrito aprovado com `--types node` para os testes de inventário. A classificação foi conferida contra oito arquivos de rota, métodos exportados e onze ações literais. Esse inventário detecta alterações nas formas sintáticas atuais; não substitui parsing completo, testes de sucesso das rotas ou validação dos serviços após a futura integração.

A revisão independente desse segundo avanço apontou dois ajustes: um escopo próprio para validar rascunho novo sem workspace persistido e rejeição de caracteres Unicode invisíveis também fora da categoria de formatação. Ambos foram corrigidos, com regressões específicas e nova execução dos 44 testes e checks estáticos. O pai conferiu os ajustes; não houve nova revisão independente completa após essas correções.

Terceiro avanço: 68 testes passaram em cinco arquivos, lint dos quatro arquivos novos sem avisos e TypeScript estrito aprovado. Após um retorno antecipado para negar contextos sem acesso antes de percorrer grants, os 24 testes afetados passaram novamente, assim como lint e tipos. O revisor independente aprovou esse corte estático e confirmou especificamente o encerramento dos dois P2 anteriores. Nenhum teste precisou de cookie real, banco, servidor ou Solver. A aprovação continua restrita às funções puras, sem certificar a integração futura.

Quarto avanço: foi preparado o [candidato de persistência](escalas-access-persistence.md), aditivo, ainda fora do histórico automático de migrações. O schema recebeu 53 linhas, sem exclusões; Prisma validate, geração local do cliente e TypeScript da aplicação inteira passaram. O núcleo do SQL candidato coincide com o diff gerado entre os schemas e recebeu checks adicionais de integridade. A revisão independente aprovou esse corte estático. Os testes PostgreSQL estão escritos, mas não foram executados; execução real, exclusões/cascatas e compatibilidade do legado continuam requisitos para promoção. Nenhuma rota, sessão em uso ou dado foi alterado.

Quinto avanço: [contrato do cadastro administrativo](escalas-operator-administration.md) implementado em dois arquivos novos, sem gravação ou chamador no produto. As quatro entradas preparadas exigem campos explícitos, recusam campos internos e capacidades administrativas, normalizam nomes/filiais e exigem versão nas alterações. Passaram 48 testes nesta rodada (20 novos e 28 das dependências), lint e TypeScript completo. A revisão independente aprovou o corte estático; autenticação, existência dos recursos e transações ainda pertencem à integração futura.

Sexto avanço: [contrato das projeções PDF/XLSX](escalas-export-projections.md) preparado sem alterar handlers ou renderizadores. Identidade de cache inclui projeção, versões e metadados canônicos; o descritor não permite análises no básico ou em qualquer XLSX e exige ausência de seções setoriais. Passaram 43 testes nesta rodada (18 novos, 5 do cache e 20 de permissões), lint e tipos completos. Revisão independente estática aprovada. A separação de bytes foi testada no cache existente; proteção dos downloads e conteúdo dos arquivos ainda precisam da integração real.
