# Correção do cleanup das fixtures de acesso de Escalas

Data: 2026-11-14. Tarefa `AUX-E2E-E2ER01-FIX r1`, despacho `AUX-E2E-E2ER01-FIX:r1:batch315`, reserva316. Gate315: `224ecf525759bf4ba27400d62e0d0a833c18b44c5eecf558f470dc1a15fa6e36`.

Checkout: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.

## Defeito e correção

A revisão independente identificou E2ER01/P1: a fixture exigia a exclusão física do ADMIN que assinou aprovações. Revogar uma aprovação mantém a linha, seu `approvedById` e a relação com exclusão restrita. A rota de exclusão de conta traduz a recusa P2003 em HTTP 404. A primeira asserção falhava e interrompia a limpeza das contas seguintes. Uma falha no fechamento de um contexto também podia impedir os fechamentos posteriores.

`web/e2e/escalas-access-fixtures.ts` agora registra o possível aprovador **antes** de enviar APPROVE. Isso também preserva a identidade quando o servidor pode ter gravado e a resposta se perde ou não pode ser decodificada. A limpeza bloqueia essa conta por PATCH administrativo com `{status: "BLOCKED"}` e exige HTTP 200. Não tenta excluí-la nem excluir seu tenant por outro caminho. O registro histórico permanece até o descarte do banco exclusivo pelo harness.

Essa retenção é conservadora: qualquer tentativa de aprovação enviada pelo helper retém o proprietário, inclusive quando não é possível determinar se houve gravação. Aprovações com IDs recebidos continuam sendo revogadas. Uma aprovação cujo ID se perdeu não é declarada revogada; sua resolução final depende do descarte do banco isolado.

Cada operador, política de acesso, workspace, aprovação, conta e contexto tem tentativa de limpeza independente. As falhas são coletadas com identificação do recurso e causa original. Depois de tentar todos os recursos e o contexto administrativo de preparação, o helper lança `AggregateError` se houve falhas. Contas próprias sem tentativa de aprovação continuam removíveis. Um 404 inesperado ao excluir conta continua sendo erro; não foi convertido em sucesso.

As contas aprovadoras são bloqueadas depois das operações que precisam da sessão administrativa própria. Os workspaces e contas removíveis continuam restritos aos IDs registrados pela fixture. Não houve exclusão de histórico, mudança de FK/trigger, mudança de API ou alteração de asserção funcional dos specs.

## Regressão permanente e evidência vermelho/verde

Novo arquivo: `web/scripts/escalas-access-fixtures.test.mjs`.

O teste lê o helper real completo, transpila-o em memória com esbuild já instalado e o carrega em uma VM com imports controlados. Não extrai nem copia uma implementação alternativa do cleanup. Browser, páginas, solicitações, entrega de convite e persistência são contratos simulados em memória; Playwright real e módulos de produto não são carregados. O contrato de exclusão do aprovador devolve 404 enquanto a aprovação retém `approvedById`, inclusive depois da revogação.

Comando executado no checkout, usando o Node já disponível:

```text
node --test web/scripts/escalas-access-fixtures.test.mjs
```

| Caso puro sobre o helper real | Verificação |
| --- | --- |
| Aprovação confirmada | Aprovador bloqueado e retido; aprovação revogada; outra conta e workspace removidos; contextos recebem fechamento. |
| Resposta perdida após gravação | Aprovador retido mesmo sem ID de aprovação recebido; outra conta removida; aprovação desconhecida permanece para descarte do banco. |
| Resposta 201 com JSON ilegível | Mesma proteção, sem depender da leitura do corpo para registrar o possível aprovador. |
| Falhas intermediárias | Falham atualização de operador, modo de acesso, um workspace, uma revogação, exclusão de conta com 404 e um fechamento. Os seis erros são agregados; segundo operador/workspace/aprovação/conta e demais contextos ainda recebem suas operações. |
| Nenhuma tentativa de aprovação | ADMIN próprio e outra conta continuam sendo excluídos. |
| Falha no bloqueio do aprovador | Erro agregado, sem fallback para exclusão física; outra conta e contextos seguem sendo tratados. |

**Antes da correção:** 6 casos executados, 1 aprovado, 5 falhas, exit 1. O caso principal e os dois resultados incertos reproduziram `404 !== 200`. Fonte anterior SHA-256: `18bb6fa9e3182127e8298198cf1571cf1dae1db6e778053b16758ecfe649e661`.

**Depois da correção:** os mesmos 6 casos executados, 6 aprovados, zero falhas/skips, exit 0. O arquivo de regressão foi mantido entre as execuções vermelha e verde. Os logs estão em `outputs/escalas-e2e-cleanup-fix/red.log` e `green.log`.

## Verificação estática delimitada

- Sintaxe: helper TypeScript e nova regressão JavaScript, zero erros.
- Biome com as regras existentes, configuração temporária incluindo apenas os dois arquivos: exit 0, zero erros/avisos. Configuração do repositório preservada.
- TypeScript nativo instalado, `--noEmit`, helper como única raiz: exit 0. Fechamento de 29 imports locais, zero caminhos Prisma e zero imports locais não resolvidos. Nenhuma geração de cliente.
- Listagem Playwright protegida: **16 testes em 6 specs consumidores do helper**, exit 0. Configuração temporária sem webServer/globalSetup e com bloqueio de rede, abertura de servidor, subprocessos, Prisma e `.env`; zero tentativas registradas. Os 16 testes foram somente listados. A listagem anterior de 37 não foi apresentada como execução nem repetida integralmente.

Configurações utilizadas, guarda, logs e resultados ficam no diretório de evidências desta tarefa, junto do manifesto SHA-256. Context Mode foi usado efetivamente com `ctx_batch_execute` na coleta e `ctx_execute` na análise. As edições foram feitas por apply_patch nativo.

## Contrato com o harness e limite da entrega

O harness já entregue continua responsável por encerrar a aplicação e descartar o banco exato de cada fase, inclusive se o caso ou seu cleanup falhar. As identidades aprovadoras bloqueadas, suas aprovações e os registros históricos não são removidos pela fixture. Não é necessário mudar o runner para esta correção.

Esta entrega substitui somente a descrição anterior de limpeza das identidades em `docs/escalas-e2e-updated.md`; esse documento e suas evidências históricas não foram alterados. O contrato de configuração, as fases geral/nominal e a regra de isolamento permanecem sob a entrega do harness.

**Os seis casos são testes puros com mocks.** Não executam a FK em PostgreSQL nem comprovam PATCH/DELETE reais, autenticação, entrega de e-mail real ou cenário nominal completo. Nenhum browser, API real, banco, seed, Prisma generate, Solver, Docker, quality/build, serviço, ambiente funcional, instalação ou produção foi executado/acessado nesta tarefa. Não houve alteração de runner/configuração, seed, schema/FK/triggers, APIs, produto, outros specs ou package/lock; nem commit, push ou implantação.

A próxima etapa é a revisão independente já enfileirada. A confirmação integrada do cenário nominal e do descarte do banco continua dependente da execução funcional autorizada do harness.

## Insumos conferidos

- `docs/escalas-e2e-updated-review.md`: `2d464e45a195438d1f812e3ed2baa73b70bb7ad9aad4641c1c0ebf0d9f7f0b55`.
- `outputs/escalas-e2e-updated-review/cleanup-contract-reproduction.json`: `6dbeca40cb3b88c9a2fa7e051dc7fcd44e372addb0f9f2f42818a19e5dec6402`.

Os hashes atuais do helper corrigido, da regressão, deste relatório, dos insumos e das evidências constam em `outputs/escalas-e2e-cleanup-fix/manifest.json`.
