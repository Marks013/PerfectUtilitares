# Contrato candidato do cadastro administrativo de operadores

13/11/2026. Clone isolado, base `c10602c246f3ec7a5f4bf64ae805cddf3cb960ce`. Implementação em `web/src/lib/escalas/operator-admin-input.ts`, sem chamadores no produto. A revisão independente aprovou estaticamente este contrato e os testes. Não há API, tela, gravação ou ativação de acesso nesta entrega.

## Comandos preparados

| Comando | Entrada obrigatória | Responsabilidade futura do serviço |
|---|---|---|
| CREATE_OPERATOR | username, displayName, active e branchGrants | Criar identidade própria do módulo e vínculos explícitos, com unicidade por empresa e auditoria. |
| UPDATE_OPERATOR | operatorId, expectedPermissionVersion e perfil completo: username, displayName, active | Conferir versão atual, alterar perfil, incrementar versão e revogar sessões quando houver alteração. |
| REPLACE_BRANCH_GRANTS | operatorId, expectedPermissionVersion e lista completa branchGrants | Comparar conjunto atual e pretendido; aplicar a nova concessão integral e invalidar o acesso anterior na mesma transação. Lista vazia retira o acesso a todas as filiais. |
| REVOKE_SESSIONS | operatorId e expectedPermissionVersion | Incrementar versão e revogar sessões, mesmo quando o cadastro não mudou. Não é exclusão do operador. |

Cada vínculo exige branchCode, active e capabilities. Não há campos opcionais com poderes implícitos. Um operador pode ser preparado inativo, sem filial, ou com um vínculo sem capacidades. Esses estados continuam sem acesso utilizável conforme a resolução já preparada; o parser não acrescenta permissões para torná-los utilizáveis.

O corpo não aceita tenantId, role, ID do autor, ID gerado, versões internas, usernameNormalized, modo do módulo ou campos de outro comando. O identificador do operador é apenas um alvo solicitado: não comprova que ele existe nem que pertence à empresa do administrador. O modo ADMIN_ONLY/SCOPED, a política de geração aprovada e a exclusão ficam fora desse contrato.

## Normalização e limites

O nome de entrada usa exatamente `normalizeEscalaOperatorUsername`, compartilhado com a futura entrada por nome; o resultado do parser contém usernameNormalized. O nome exibido preserva maiúsculas, acentos e pontuação após normalização Unicode e de espaços. Digitar ADMIN continua produzindo um nome operacional, sem atribuir papel administrativo.

Os limites são 256 unidades UTF-16 brutas/64 pontos de código normalizados para username, 512 unidades brutas/120 pontos de código normalizados para displayName e 640 unidades brutas/160 unidades canônicas para filial. IDs seguem o conjunto de caracteres de identificadores existente, sem remover espaços nem inferir outro ID. expectedPermissionVersion aceita inteiros de 1 a 2147483647; o serviço deverá recusar incremento que exceda esse limite, sem zerar ou reutilizar versões.

Controles, Unicode inválido e caracteres invisíveis são recusados. Filiais usam `canonicalBranchCode`, inclusive 1/01/001 → 01, e duplicidades são rejeitadas depois dessa transformação, mesmo entre vínculos inativos. Códigos textuais preservam caixa e conteúdo conforme o normalizador existente. Isso não substitui a conferência de existência na fonte canônica da empresa.

Uma requisição admite até 256 vínculos explícitos. Cada vínculo admite somente o catálogo fechado de nove capacidades operacionais, sem repetição; a ordem de saída das capacidades segue o catálogo para comparação consistente. A ordem das filiais é preservada, sem significado de prioridade. Não são delegáveis importações, exportação de integração, análises, configurações, publicação, exclusão ou gestão de acessos. PDF/XLSX básicos permanecem delegáveis.

Coleções excessivas são recusadas antes de percorrer seus itens. O transporte futuro ainda deverá limitar o tamanho em bytes antes de decodificar JSON. Erros devolvem apenas código, caminho de campo e motivo fixo, em até 12 itens; não devolvem valores rejeitados, nomes de propriedades desconhecidas ou mensagens internas do validador. As funções de parser não escrevem logs.

## Integração administrativa que permanece pendente

`ok: true` significa somente entrada estruturalmente válida. Antes de qualquer mutação, o serviço deverá:

1. Resolver conta administrativa ativa e empresa pelo contexto autenticado atual. Não usar o nome operacional, o corpo da requisição ou a identidade de outro cookie para conceder administração.
2. Consultar o operador dentro da empresa e validar todas as filiais na fonte canônica autorizada. O projeto ainda não tem o cadastro mestre de filiais de Escalas definido para esse uso; não improvisar outra tabela ou um workspace mensal como essa identidade.
3. Aplicar a precondição de versão na própria transação de escrita. Duas alterações concorrentes baseadas na mesma versão não podem ser ambas aceitas; a segunda precisa retornar conflito sem sobrescrever a primeira.
4. Manter alteração de cadastro/concessões, incremento de versão, revogação e auditoria na mesma transação. Falha de unicidade, auditoria ou atualização deve reverter o conjunto. Não registrar o payload pessoal completo na auditoria.
5. Tratar repetição sem mudança como ausência de alteração, preservando a versão; REVOKE_SESSIONS é uma ação explícita de invalidação e incrementa a versão. A comparação de concessões deve considerar conjuntos canônicos, não a ordem apresentada no formulário.
6. Garantir que uma sessão concorrente baseada na versão antiga não fique utilizável após a alteração. A emissão e a resolução devem conferir registros atuais; resultados de jobs exigem nova autorização antes de consulta/aplicação.

Testes de integração necessários: sucesso real de cada comando; erro de outro tenant sem revelar cadastro; unicidade depois da normalização; filial inexistente; concorrência da versão; rollback integral por falha; revogação durante emissão e consulta; tentativa de fornecer campo interno; limite de versão; preservação do administrador e das contas gerais legadas.

O candidato de persistência permanece fora das migrações automáticas. Para o banco, seguir `escalas-access-persistence.md`; os testes PostgreSQL ainda não foram executados. A integração de rotas, sessões e serviços existentes aguarda a revisão consolidada do Central e a prova de migração. Não existe uma gestão administrativa funcional ou pronta para produção apenas por este parser ter passado nos testes.

## Verificação executada

Com Node 24.22.1 e dependências existentes do lockfile: 48 testes aprovados em operator-admin-input, operator-username e permissions, sendo 20 testes novos do contrato; lint dos dois arquivos novos sem avisos; TypeScript da aplicação inteira aprovado com `tsc --noEmit --incremental false`. A revisão independente encontrou o contrato coerente e não apontou defeito bloqueante. Não executou testes adicionais nem alterou arquivos.

Nenhum banco, servidor, Solver, rota ou ambiente compartilhado foi usado. Não foram instaladas dependências, criados commits, enviados arquivos remotos ou executados quality/build/E2E de liberação.
