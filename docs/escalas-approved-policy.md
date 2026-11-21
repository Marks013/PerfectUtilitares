# Configuração administrativa aprovada por filial e período

## Estado e limites

Despacho AUX-APPROVED-POLICY:r1:batch65, gate65/hash `77b6f9827b67595ebe2a4f1362ef436de0e4fa7160be50a5bfa218d88428b3d4`, reserva66. Implementação candidata somente no clone `PerfectUtilitares-planejamento-20261113`, base `c10602c246f3ec7a5f4bf64ae805cddf3cb960ce`. A reconciliação com a referência consolidada `8651e77b108cd3026d50707dea60c03963c9faaf` pertence ao coordenador e ainda não ocorreu neste corte.

O contrato permite preparar uma aprovação antes de existir workspace. Não há cadastro mestre Escalas fora de `EscalaRevision.input`: por isso a aprovação contém configuração, cadastro inicial de colaboradores e turnos, referências e modelos de regime. Uma cópia isolada de `policy` não seria suficiente para criar uma grade coerente.

Nenhuma API, serviço, componente, Solver, importador ou arquivo gerado foi alterado. Nenhum banco foi acessado, criado ou migrado. O SQL fica fora de `web/prisma/migrations` e **não foi executado**. Não promover esse schema/cliente como se o banco estivesse alinhado. Esta entrega não conclui a autorização ou a funcionalidade operacional.

## Contrato público para a próxima integração

Em `web/src/lib/escalas/approved-policy.ts`:

| Exportação | Responsabilidade pura |
| --- | --- |
| `ESCALA_APPROVED_POLICY_SCHEMA_VERSION` | Versão fechada do envelope, atualmente 1. |
| `EscalaApprovedPolicySnapshot` | Configuração, seed, modelos e proveniência validados. |
| `EscalaApprovedRegimeModel` | ID próprio, rótulo, colaborador fonte e projeção fechada dos campos protegidos. |
| `EscalaApprovedPolicyCandidate` | Colunas candidatas para persistência, snapshot e SHA-256. |
| `buildEscalaApprovedPolicy(unknown)` | Valida a entrada administrativa, deriva modelos e prepara snapshot/hash no servidor. |
| `readEscalaApprovedPolicy(snapshot, expectedHash)` | Revalida formato, referências, coerência e integridade do conteúdo armazenado. |
| `createInputFromEscalaApprovedPolicy(snapshot, expectedHash)` | Retorna um novo `EscalaInput` apenas para o período técnico exato aprovado. |
| `addEmployeeFromEscalaApprovedModel(snapshot, expectedHash, enrollment)` | Demonstra a inclusão sobre a seed usando modelo resolvido no servidor, sem aceitar regime do cliente. Não é um editor de workspace existente. |

Os resultados são `{ok: true, value}` ou `{ok: false, code: "INVALID_APPROVED_POLICY"}`. Não retornam valores rejeitados, nomes pessoais ou conteúdo do snapshot em erros. Os objetos retornados são cópias independentes; a imutabilidade persistida depende também do trigger SQL. O módulo usa `node:crypto` e deve permanecer no servidor.

Entrada de `buildEscalaApprovedPolicy`:

```ts
{
  input: EscalaInput,
  version: number, // inteiro positivo, determinado transacionalmente pelo servidor
  provenance: {
    tenantId: string,
    approvedById: string,
    approvedAt: string, // instante UTC exato com milissegundos: YYYY-MM-DDTHH:mm:ss.sssZ
    origin: null | { workspaceId: string, revision: number }
  },
  selectedSeedAssignments: Array<{
    employeeId: string, date: string, kind: "ABSENCE" | "HOLIDAY"
  }>,
  regimeModelSelections: Array<{ id: string, label: string, employeeId: string }>
}
```

Esse objeto é montado pelo serviço administrativo com identidade, data e origem canônicas. Não é um corpo HTTP autorizado: passar nele `approvedById` não comprova identidade nem aprovação. O serviço futuro deve rejeitar esses campos no corpo do cliente e obtê-los da sessão e do estado confiável.

O builder usa `escalaInputSchema` existente, sem materializar overrides. Exige filial já canônica, datas e horizonte válidos, pelo menos um colaborador e um modelo, política revista com fonte/revisor e vigência cobrindo o período. Rejeita campos desconhecidos, duplicações, referências inválidas, horários ausentes e seleções sem definição coerente. Não determina validade trabalhista nem prontidão de publicação: continuam necessárias as validações de domínio existentes e a revisão administrativa real.

## Conteúdo aprovado e continuidade

O envelope fechado tem cinco campos: `schemaVersion`, `configuration`, `seed`, `regimeModels`, `provenance`.

`configuration` conserva identificação da filial, horizonte técnico, mês visível, fuso, versões/regras/modo de geração, indicação de simulação, fechamento, referência semanal, setores mistos, política completa, demandas e prioridades de movimento. Não conserva fingerprints de geração/cobertura nem `needsRegeneration`: uma aprovação não é prova de grade gerada.

`seed` conserva todos os colaboradores e turnos aprovados, com IDs e matrículas textuais. **Conserva `history`, `historyKnown`, `sourceSchedule`, `originalShiftIds`, contratos individuais e demais proveniências aprovadas** quando validados pelo schema. `history` é continuidade factual anterior aprovada, distinta de uma grade gerada; a validade sintática não prova que uma escala de teste foi efetivamente cumprida. O serviço deve verificar essa fonte antes da aprovação. O builder não converte conhecido em desconhecido nem inventa comparecimento.

`planningHistory` e `planningFuture` são contexto publicado derivado, distinto de fatos. Se contiverem registros, o builder rejeita a preparação: esta etapa não dispõe de recarga canônica substituta. Coleções vazias são omitidas. A integração deverá recarregar esse contexto no servidor e estabelecer uma estratégia explícita de aprovação/comparação antes de suportar esse caso. Não é permitido limpar fatos ou contexto necessário apenas para fazer a preparação passar.

Em `seed.assignments`, entram somente `ABSENCE`/`HOLIDAY` **explicitamente selecionados**, presentes na entrada administrativa e dentro do mesmo período e vínculo. Feriados precisam constar no calendário aprovado. Locks dessas seleções são preservados. `WORK`, `OFF` e `DUTY` da grade atual são excluídos e não podem ser selecionados. Não há transporte automático para outro mês, reaproveitamento de teste como histórico real ou criação de uma nova escala gerada.

Seleções manuais existentes na seed são preservadas e suas referências/segmentos devem coincidir com as marcações aprovadas, sem materialização corretiva. Um colaborador com seleção manual ou restrição importada derivada não pode ser usado como modelo genérico nesta versão; o builder rejeita essa escolha em vez de descartar sua particularidade. Pode ser preservado na seed e coexistir com outro modelo válido. Se não houver um exemplar suportado, é necessária decisão de contrato, não remoção artificial dos campos.

## Modelos de regime e novo cadastro

Modelos têm IDs próprios fora de `EscalaInput` e do Solver. O administrador seleciona ID/rótulo/colaborador fonte; o servidor extrai os campos. Não aceita `protectedFields` ou JSON livre de regime do cliente.

A projeção protegida do modelo contém setor, cargo, jornada semanal e sua modalidade individual/filial, referência diária de simulação, referências de turnos, inclusão/exclusão de planejamento e seu motivo, modalidade de horário, modo/padrão/dias fixos de folga e regra/limite de domingos. Não substitui uma jornada individual pela referência da filial. Não cria regras trabalhistas nem infere enquadramento pelo nome/cargo.

O comando de inclusão aceita apenas `id`, `regimeModelId`, `name`, `registration`, `activeFrom`, `activeUntil?` e `preferredOffDays`. O serviço deve gerar/resolver o ID no servidor e validar matrícula/vínculo no estado atual. O exemplo puro exige admissão explícita para um novo cadastro, valida duplicações/vínculos e copia o regime aprovado. Começa sem histórico conhecido; não copia proveniência FPRE, histórico, liderança pessoal ou seleções manuais do exemplar. Os campos operacionais desta projeção são uma fronteira estreita desta etapa, não autorização automática de rota ou relaxamento dos guards atuais.

## Persistência e integridade

`EscalaBranchPolicyVersion` tem tenant/id, filial canônica, datas técnicas exatas, mês visível opcional, versão positiva, versão do snapshot, JSON, hash, administrador/data de aprovação, origem opcional workspace/revisão e revogação. Não cria cadastro paralelo de filiais. A unicidade é tenant/filial/início/fim/versão e tenant/id. A referência de origem é composta e toda nula ou toda preenchida; aprovador e origem ficam presos ao mesmo tenant por FK. A FK do aprovador prova existência/tenant, não papel ADMIN ou estado ativo.

`EscalaRevision.approvedPolicyVersionId` é opcional, com FK tenant/id e `Restrict`, índice e relações inversas. O legado continua nulo, sem seed/backfill ou aprovação implícita. As FKs preservam histórico. O trigger impede exclusão, alteração do conteúdo e reversão/alteração de uma revogação já registrada. Corrigir conteúdo exige outra versão. Revogar não modifica snapshot/hash e não apaga revisões antigas.

SHA-256 usa JSON canônico com chaves de objetos ordenadas e UTF-8, calculado pelo servidor. Ordem dos arrays é preservada e participa do hash. O hash cobre snapshot/proveniência, não ID da linha, número de versão ou revogação; estes são conferidos separadamente pelo serviço. Não calcular hash a partir de `jsonb::text`. O SQL valida formato/colunas do envelope, datas, versões e hash, mas não implementa todo o schema TS nem recompõe o hash: chamadas puras e rechecagem do serviço são obrigatórias.

## Sequência obrigatória de integração futura

1. **Aprovar antes de criar workspace:** autenticar administrador atual, resolver tenant, obter configuração/equipe/turnos e fontes autorizadas; validar origem e identidade exatas; construir o candidato no servidor. Em transação, conferir a revisão de origem/CAS e estado atual, alocar versão sem corrida e persistir conteúdo aprovado imutável. Não fabricar workspace para descobrir uma filial.
2. **CREATE exato do operador:** aceitar somente referência da aprovação e filial/datas técnicas/mês visível exatos, nunca `input` ou configuração do cliente. Autorizar criação para a filial, carregar linha no tenant e verificar não revogada, versão/formato/hash e correspondência de todas as colunas com a proveniência/configuração. Validar que a origem pertence ao tenant/filial/período quando fornecida. Não derivar aprovação de workspace de outro mês.
3. Na mesma transação de CREATE, revalidar sessão/grants/revogação, bloquear a linha de aprovação contra revogação concorrente, checar a ausência de workspace e criar workspace/revisão com `approvedPolicyVersionId`. A unicidade existente tenant/filial/período impede dois workspaces concorrentes; conflito deve ser estruturado. Aprovação por si só não cria grade.
4. **Revisões seguintes herdam a referência:** carregar base canônica e verificar expectedRevision/CAS. Guardar a comparação de configuração e campos protegidos **antes de materializar overrides**, normalizar cenários ou executar Solver. As diferenças operacionais permitidas são controladas pelo serviço; o cliente não pode trocar aprovação, regime ou proveniência. Revalidar atribuições, locks, vínculos, catálogo e limites existentes depois da preparação também.
5. **Admin rebase:** mudar referência administrativa somente por ação explícita do administrador, produzindo nova revisão vinculada à nova aprovação, com comparação e consequências visíveis. Não sobrescrever revisão, regime ou histórico. Mudanças materiais invalidam grade/fingerprints e exigem recálculo. Revogar uma aprovação bloqueia novos usos operacionais sem apagar leitura/auditoria do histórico.
6. Rechecar tudo transacionalmente no save/finalização de jobs: tenant, ator, sessão/grants/versões, aprovação/revogação, recurso/período, CAS e campos protegidos. Não reutilizar um guard anterior ao job como autorização permanente. Legado com referência nula não habilita CREATE/edição operacional por inferência; requer caminho administrativo explícito.

### Reimportação substitutiva confirmada pelo usuário

Durante este despacho, o usuário definiu que importar sobre uma equipe existente substitui os registros no escopo do arquivo, **tanto para colaboradores quanto para afastamentos**: atualiza presentes, acrescenta novos e remove os ausentes nesse escopo. Essa orientação substitui a preservação anterior de ausentes para futuras importações. Não autoriza aplicar um pacote antigo automaticamente.

O importador e suas rotas estão fora deste ownership e não foram modificados. A integração deverá validar o arquivo inteiro, tenant/filial/período e amplitude exata da substituição antes da escrita; apresentar o resultado e efetivar remoções/inclusões/atualizações atomicamente com CAS. Registros fora do escopo importado não são alvos. Arquivo inválido ou incompleto não pode causar substituição parcial. Reimportar não significa aprovar silenciosamente um novo regime: a mudança administrativa deve produzir aprovação/revisão explícitas conforme o contrato acima. As regressões do importador, incluindo remoção de ausentes para os dois tipos de registro, ficam pendentes para sua própria etapa autorizada.

## Verificação e liberação

Testes focados cobrem sucesso com continuidade factual/proveniência, seleção explícita e exclusão de grade gerada, rejeição de contexto publicado sem substituto, isolamento de cópias, hash estável/tampering, campos desconhecidos, filiais canônicas, datas, IDs/refs/duplicações, modelos e cadastro sem alteração de contrato. Lint e tipos foram executados somente nos dois arquivos novos. Prisma validate e diff schema→schema são offline; não foi gerado client.

Evidência final deste corte: 18 testes Vitest aprovados em `approved-policy.test.ts`; Biome lint dos dois arquivos sem avisos; TypeScript estrito delimitado com `--ignoreConfig --noEmit --strict --skipLibCheck --module ESNext --moduleResolution bundler --target ES2022 --types node` aprovado; `git diff --check` do Prisma aprovado. `prisma validate` aprovou o candidato. O diff offline retornou exit 0 e seu SQL de 46 linhas coincidiu exatamente com o bloco delimitado, normalizando apenas CRLF e espaços externos. Foi usada URL sintética de loopback na porta 1 exclusivamente para satisfazer a configuração do CLI; nenhum comando solicitou conexão ao banco. Coleta/análise/execução e agregação dos checks usaram `ctx_execute`, validado neste próprio chat, e edições usaram `apply_patch` nativo. Não houve delegação ou mensagens laterais.

O bloco delimitado `BEGIN/END PRISMA SCHEMA DIFF` do SQL deve coincidir byte a byte, após normalizar CRLF, com o diff entre o schema anterior a este corte e o candidato. Os checks/trigger adicionais ficam após esse bloco. O arquivo `escalas-approved-policy.verify.sql` tem guard obrigatório de nome de banco com prefixo literal `escalas_access_test_`, transação e rollback; está preparado, **não executado**. A fixture SQL testa somente armazenamento/constraints, usa conteúdo sintético e hash de formato; não é aprovação válida de aplicação.

Não houve quality/build/typecheck global, geração de client, instalação, commit, push, migração ou deploy. Faltam PostgreSQL real no ambiente existente autorizado, revisão integrada com a referência do Central, serviço/rotas/guards, concorrência transacional, sucesso real por API e smoke autenticado. O próximo chat pode consumir este contrato após a reconciliação dos escritores; liberar estes seis arquivos não libera produção.
