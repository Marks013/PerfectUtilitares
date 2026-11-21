# Contrato de acesso por rota de Escalas

Base: `c10602c246f3ec7a5f4bf64ae805cddf3cb960ce`, clone independente, 13/11/2026. Código em `web/src/lib/escalas/route-policy.ts`. Não conectado aos handlers. Esta entrega complementa a matriz pura de `permissions.ts` e a normalização de `operator-username.ts`.

## Como consumir na integração futura

`classifyEscalaRoute` recebe a rota canônica, método e seletores já extraídos do contrato HTTP. Não recebe cookies, grants, empresa ou papel do cliente. Retorna uma classificação `denied`, `session` ou `resource`; nunca `allowed: true`.

Para um recurso, `allOf` contém capacidades fixas, `scope` identifica a origem canônica do escopo e `requiredChecks` enumera verificações adicionais obrigatórias. Satisfazer `allOf` não basta para permitir a operação. O adaptador deve resolver principal atual, empresa e recurso no servidor, avaliar cada capacidade pela matriz e executar todos os controles aplicáveis antes de usar cache, retornar dados ou gravar. Erro ou verificação não implementada impede ativar essa rota para operadores.

Validação HTTP, limites de tamanho/tipo, origem/CSRF, rate limit e erros estruturados existentes continuam necessários. A classificação não substitui essas barreiras. Nomes de guardas representam contratos de integração, não funções já executadas.

## Mapa fechado

Prefixo das rotas: `/api/escalas`.

| Rota / operação | Capacidades fixas | Verificações que permanecem obrigatórias |
|---|---|---|
| `/access/session` GET, POST, DELETE | Tratamento próprio de sessão | Conferir sessão/operador/modo; entrada só em SCOPED; saída revoga somente a própria sessão, mesmo depois de perder grants. |
| GET coleção e GET catálogo `/turnos` | `workspace.read` | Avaliar e filtrar grants efetivos; catálogo só traz códigos/horários da empresa, não pessoas de outras filiais. |
| GET workspace | `workspace.read` | Resolver empresa e filial pelo recurso; o ID do cliente não define autorização. |
| CREATE | `workspace.create` | Aprovação exata de empresa/filial/período, versão ativa, campos protegidos e capacidades complementares derivadas da alteração. |
| SAVE | `workspace.save` | Revisão/CAS, comparação canônica dos campos, locks, política e capacidades complementares. |
| VALIDATE | `workspace.save` | Referência canônica da entrada e comparação de campos; o contrato HTTP atual ainda não fornece essa referência. |
| GENERATE / START_GENERATION | `schedule.generate` | Escopo, revisão, política, propriedade da operação quando aplicável e rechecagem antes de devolver resultado. Não exigir aplicação para apenas gerar uma proposta. |
| CANCEL_GENERATION / GENERATION_STATUS | `schedule.generate` | Operação própria, empresa/filial e autorização atual. Status também pode expirar/cancelar a operação. |
| PUBLISH | `workspace.publish` | Revisão e validação; preservar APPROVER apenas no vínculo legado que já autoriza publicação. |
| DELETE workspace | `workspace.delete` | Administrativo; recurso e revisão canônicos. |
| `/import` GET modelo e POST prévia | `import.manage` | Administrativo antes de ler/processar arquivo. Upload validado; afastamentos exigem contexto canônico de filial/período/equipe. |
| `/turnos` SYNC | `import.manage` + `shift.manage` | Todas as fontes/revisões autorizadas e catálogo imutável por empresa. |
| PREVIEW_SWAP | `shift.manage` | Workspace, revisão, colaborador, catálogo, política e locks. |
| APPLY_SWAP | `shift.manage` + `workspace.save` | Recalcular prévia/hash, política/locks, revisão e capacidades condicionais da alteração de grade. |
| `/export` PDF/XLSX básico | Capacidade do formato | Escopo/revisão, HOURS_ONLY e projeção antes do cache. |
| `/export` ADMIN_FULL | Capacidade do formato + `report.analytics` | Mesmas verificações; não restaura abas Capacidade/Desfalques do XLSX. |
| `/operational-report` | `report.analytics` | Administrativo; seleção/revisão e estado de referências/grade. |
| `/turnos/export/manifest` | `export.integration` | Administrativo; todas as seleções/revisões e propriedade do manifesto. |
| `/turnos/export` TXT1/TXT2 | `export.integration` | Administrativo; proprietário, expiração, hash/revisões, omissões e rechecagem de acesso no download. |

Rota, método, ação, propósito, formato ou projeção desconhecidos são negados. Seletores de outra rota também são negados. Métodos não classificados, inclusive HEAD/OPTIONS, não recebem permissão automática; o comportamento do framework deve ser conferido quando os handlers forem integrados.

## Pontos que não podem ser omitidos na implementação seguinte

1. **SAVE transporta entrada completa.** `employee.manage`, `shift.manage` e `schedule.apply` devem ser exigidos conforme as mudanças canônicas de cadastro, horários e grade. Um campo inalterado presente no JSON não implica uma nova ação. Mudança de política, carga, elegibilidade, limites, autorização ou bloqueio administrativo continua protegida. Flags de origem fornecidas pelo cliente não comprovam importação ou edição manual.
2. **VALIDATE ainda não informa a referência confiável.** O escopo `input-baseline` admite uma revisão existente ou configuração aprovada para um rascunho novo. A integração precisa receber e resolver essa referência antes de comparar campos, sem exigir workspace persistido do rascunho novo. Não validar política arbitrária do payload como se fosse autorizada.
3. **Aplicar proposta não é uma ação HTTP chamada APPLY.** A interface aplica localmente e salva por SAVE. A autorização de aplicação precisa acompanhar esse salvamento. APPLY_SWAP também exige `schedule.apply` quando materializar alteração de grade; alterar referências internas de colaborador não deve exigir automaticamente `employee.manage` só pela representação do dado.
4. **SYNC não é cadastro manual.** O fluxo atual usa omissões do manifesto e fontes de planejamentos, podendo cadastrar horários em massa no catálogo. Continua administrativo mesmo com uma única fonte. O cadastro manual permitido ao operador precisa de operação distinta, limitada ao contexto autorizado, sem modificar códigos já usados.
5. **Importação administrativa pode preparar a aprovação.** Não exigir snapshot aprovado para importar os dados que serão usados para preparar esse mesmo snapshot. A prévia de equipe é administrativa no tenant; afastamentos precisam de contexto canônico. CREATE operacional, por sua vez, exige aprovação já existente e válida para o período exato.
6. **Coleções não são recursos de filial única.** Listar grades ou horários exige filtrar a união dos vínculos efetivos da própria identidade. Uma autorização positiva numa filial não libera toda a empresa.
7. **Jobs e caches precisam de revalidação real.** Preservar propriedade, expiração, revisão e limites de concorrência; revogação deve impedir resultado/aplicação fora da autorização. A projeção efetiva e sua versão entram na chave de cache depois do guard.

## Verificação delimitada

Os testes exercitam composição com a matriz, negações, operações compostas, precedência de capacidades e projeções. O inventário lê os oito arquivos de rota e as formas atuais de exportação de métodos e de `action: z.literal(...)`; detecta adição/remoção nessa estrutura e força reclassificação. Não é um parser TypeScript geral nem prova que os handlers aplicam o contrato.

O conjunto local de permissões, nomes e classificação passou em 44 testes, lint e TypeScript estrito. A revisão independente identificou o escopo de rascunho novo e caracteres Unicode invisíveis não cobertos; ambos foram corrigidos e receberam regressões antes da execução final. A base ainda depende do commit integrado do Maestro Central antes de alterar sessões, serviços, handlers ou relatórios. Nenhuma migração, ativação, escrita de grade ou implantação foi feita.
