# Decisões pendentes: permissões, credenciais, calendários e cobertura

Este registro **não aprova mudanças de contrato**; mapeia escolhas necessárias antes de migrar informações de colaboradores/filiais.

## D01 · Acessos individuais por filial (A02)

**Estado:** NÃO autorizado para implementação. O responsável solicitou anteriormente não criar uma nova gestão administrativa se ausente.

- O backend `EscalaBranchAccess` suporta `VIEWER` (consulta), `PLANNER` (planejamento) e `APPROVER` (publicação).
- Falta confirmar UX/rotas administrativas de listagem, concessão e revogação. Não criar por inferência.
- Uma autorização futura deve exigir escopo `tenantId+userId+branchCode`, teste de negação cruzada, trilha de auditoria e revogação efetiva.

## D02 · Credencial operacional de Escalas (A03)

**Estado:** escolha operacional pendente. O código atual compartilha referência de senha com Unimed e uma sessão `moduleSessionId` permite edição sem autoria pessoal da concessão. Não altera publicação.

Alternativas para decisão: usuário nominal; conta de serviço com filial restrita; credencial específica do módulo com escopo. Priorizar identidade, revogação, expiração e caminho de contingência. Migração: adicionar configuração opcional compatível → testar transição → comunicar → rotacionar **sob autorização**. Não cortar sessão existente por alteração de código isolada.

## D03 · Filial 02 Icaraíma, domingo fechado (A05)

**Estado:** regra operacional atual `branchCode === "02"`; risco de outra empresa também ter código 02.

Definir identidade persistente inequívoca `tenantId + branchCode` ou chave de filial e versionar o calendário. Backfill de domingo fechado exclusivamente para a combinação verificada de Icaraíma, após confirmar fonte autorizada. Escalas salvas devem conservar snapshot/semântica, inclusive legado; não deslocar datas. Exigir casos de dois tenants com código 02 e jornadas noturnas de sábado.

## D04 · Cobertura estimada e mínimos obrigatórios (A04)

**Estado:** estimativa é `WARNING`, mínimo confirmado descumprido é `ERROR`; não converter um no outro.

Definir quem pode confirmar a necessidade de pessoal por setor/faixa e por qual vigência. Conferir setores vazios antes de publicar. Uma eventual confirmação de estimativa precisa ser **explícita e vinculada a filial, revisão e digest**, inválida após mudança de cenário e verificada no backend. Não preencher automaticamente mínimos a partir dos horários importados.

## D05 · Política de recuperação (A09)

Definir, com responsável por operação e dados, RPO, RTO, periodicidade de teste isolado, retenção, remoto off-site, criptografia e alertas. Sem autorização, não ativar backup externo nem criar credenciais.

## Critério comum

Depois da decisão, criar PR pequeno com análise de compatibilidade, verificador independente, testes de tenant/revisão, migração expandir–reconciliar–contrair e rollback compatível. Não alterar dados publicados implicitamente.
