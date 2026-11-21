# Acesso funcional de Escalas — entrega AUX-ACCESS-FUNCTIONAL r2

Verificação local: 14/11/2026. Despacho `AUX-ACCESS-FUNCTIONAL:r2:human-shift-catalog`.
Base conferida: `8651e77b108cd3026d50707dea60c03963c9faaf`, checkout
`C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113`.
Não houve commit, instalação, migração, implantação ou execução de quality/build global nesta frente.

## Comportamento entregue

- Autorização efetiva por operação e filial no servidor: política atual, usuário atual ou sessão nominal persistida, operador e concessões atuais. Conta autenticada tem precedência. Conta bloqueada, versão de segurança alterada, sessão revogada, operador inativo ou concessão retirada falham de forma fechada.
- Entrada por nome em `/access/session` usa apenas o fluxo nominal restrito; não há fallback para a antiga senha ampla. Nome separa a navegação, mas não comprova identidade nem protege contra alguém usar o nome de outra pessoa. Não concede administração.
- `/access/admin` lê e altera operadores, concessões, revogação de sessões e modo de acesso com autoridade administrativa real e comparação de versão. Alterações e emissão/revogação de sessão usam o mesmo bloqueio transacional por empresa. Não cria usuários administrativos nem altera senhas.
- `/approved-policy` publica/revoga versões aprovadas com origem, empresa, filial, período, conteúdo e modelos verificados. Versões são atribuídas no servidor. Conflitos retornam erro estruturado; payloads internos não aparecem na resposta.
- `CREATE_APPROVED` obtém a configuração aprovada no servidor. O caminho livre permanece administrativo. `ADD_EMPLOYEE` aceita nome, matrícula e modelo autorizado; adiciona somente a nova pessoa à equipe atual, com identificador do servidor e admissão desconhecida. Não repõe a equipe a partir da semente.
- `SAVE`, validação restrita, geração e aplicação comparam os dados recebidos com a revisão existente antes de materializar dados derivados. Protegem regras, carga, equipe, afastamentos, feriados e registros manuais, inclusive marcação antiga cujo bloqueio seja desconhecido. A edição de nomes/preferências também exige a capacidade correspondente.
- Geração com permissão exclusiva de gerar pode produzir prévia sem obter implicitamente permissão para salvar/aplicar. A proposta inclui prova HMAC com empresa, autor, sessão, revisão, aprovação, estado de acesso, conteúdo e expiração. Aplicação verifica a prova novamente dentro da transação, sem rodar novamente o solver. Revogação durante o cálculo impede a entrega.
- Alteração administrativa de configuração protegida desassocia a aprovação anterior. `ADMIN_REBASE` vincula uma nova aprovação compatível com o período sem substituir silenciosamente equipe ou grade atuais. Revisões anteriores permanecem históricas; exclusão da origem de uma aprovação é impedida.
- Histórico factual permanece distinto do contexto derivado de períodos publicados. A criação aprovada recarrega esse contexto na transação. Uma origem persistida validada pode omitir somente o contexto derivado que será recarregado; o caminho livre continua exigindo consistência integral.
- Definir/sincronizar novos turnos exige administração. Operador com capacidade explícita pode selecionar somente turno existente e compatível com a aprovação/modelo completo. A troca preserva a carga individual e verifica novamente a autorização antes de retornar/aplicar. Redesenho integral do catálogo, filtros e exportação permanece na frente própria.
- PDF/XLSX básico exige capacidade explícita por formato e filial. PDF administrativo completo continua administrativo. O PDF básico não calcula nem inclui as análises administrativas. Cache inclui projeção, revisão, versão do gerador e identidade/sessão; há nova autorização antes da entrega dos bytes, inclusive após renderização/cache.
- Importação, relatório analítico e integração TXT exigem capacidade administrativa antes do trabalho. O relatório operacional e seus renderizadores de outra frente foram preservados; esta frente alterou somente a proteção das rotas correspondentes.
- A tela SSR usa a sessão nominal restrita e entrega contexto de acesso coerente; acesso ausente/bloqueado ou falha de armazenamento não renderiza o conteúdo protegido.

## Limites de escopo

O reimportador não foi alterado. Regra humana reservada para sua etapa: reimportar sobre uma existente substitui os registros conforme o arquivo, incluindo novos e removendo ausentes, tanto para colaboradores quanto para afastamentos. Seu escopo exato de filial/período e a recuperação devem ser verificados na implementação própria antes de qualquer alteração de dados.

Não foram alterados schema/migrações, solver Python, componentes frontend de outras frentes ou os quatro arquivos `operational-report.ts/.test.ts` e `operational-report-pdf.ts/.test.ts`. O checkout contém trabalho concorrente; status global não representa autoria exclusiva desta entrega.

## Evidência de verificação

- Última seleção isolada: **34 arquivos, 450 testes aprovados e 1 ignorado**, saída 0. Inclui dois testes da própria barreira de isolamento.
- Lint dos **66 arquivos selecionados**: saída 0, sem correções automáticas, com `--diagnostic-level=warn --error-on-warnings`.
- Tipos do backend e testes selecionados: saída 0, sem emissão e sem incremental.
- Tipos incluindo página SSR e fechamento de suas dependências: **bloqueados** por `TS2322` em `web/src/components/escalas/operator-administration.tsx:60:63`: concessões com capacidades readonly/amplas não satisfazem a lista mutável de capacidades restritas esperada. Arquivo pertence a outra frente e não foi editado. Os seis testes SSR passaram; isso não substitui a resolução do erro de tipos da integração.
- `git diff --check`: saída 0.
- Contrato congelado r3 permanece byte a byte: `access-contracts.ts` SHA256 `c00eab12193033610979c4274e07e0f673aa42e31d38fc8b9693d92a24be02f0`; `escalas-access-api-contract.md` SHA256 `ae54c287a05859ada188806d706e5deaa7311d7c08a6bb6cc0ac983ce1c4c38f`.

Autorização real com persistência simulada é exercitada em `access.test.ts`, `operator-session-issuer.test.ts`, `operator-session-store.test.ts`, `operator-admin-service.test.ts`, `approved-policy-service.test.ts`, `service.test.ts` e `api/escalas/export/route.test.ts`. Os serviços administrativos/de aprovação incluem chamadas HTTP com caminho de sucesso. Exportação lê bytes PDF/XLSX reais, cobre leitor restrito, filial proibida, projeção administrativa e revogação após renderizar. `proposal-proof.test.ts` verifica conteúdo, expiração e isolamento por identidade/escopo. `operational-input-policy.test.ts` testa as barreiras puras. `page.test.tsx` usa projeções reais com leitores de identidade/persistência simulados.

Testes de transporte de outras rotas e testes de domínio de catálogo/troca substituem explicitamente a fronteira de autorização; seus resultados não são apresentados como comprovação independente de autorização real. Os testes citados acima cobrem essa fronteira separadamente. Bloqueios SQL e concorrência PostgreSQL real continuam sem validação integrada.

O único caso ignorado é `carries real Python-shaped automatic work through client, proposal, save, reload and swap`, de `service.test.ts`. Uma tentativa anterior falhou no requisito POSIX de permissão do segredo do transporte Python (0600 esperado, 0666 observado no Windows). Não se flexibilizou a proteção e não se considerou esse caminho validado.

Antes de implantar, a coordenação ainda precisa resolver o tipo do frontend e executar os gates globais, validação de Compose no ambiente autorizado, banco integrado e smoke E2E autenticado. Não houve teste de produção nesta entrega.

## Incidente de isolamento e correção

Um teste antigo de troca, sem mock para a nova autorização, tentou a consulta de leitura `escalaModuleAccessPolicy.findUnique`, pela sequência `requireEscalaCapability` → `currentEscalaPermissionContext`. O adaptador lançou `PrismaClientKnownRequestError` antes de qualquer operação de escrita. O teste já substituía carregamento do planejamento, catálogo e salvamento; o erro ocorreu na primeira leitura de política. Não se afirma ausência de tentativa de acesso ao banco. Não foram inspecionados/copiados segredos, alteradas permissões ou alcançados os caminhos de escrita dessa chamada.

Depois desse incidente, todos os resultados finais acima foram obtidos com URL sintética apenas no processo, mock Prisma padrão que rejeita qualquer acesso não simulado e bloqueio de sockets/fetch. O autoteste confirma falha antes de acessar delegates Prisma ou abrir rede. Apenas apontar uma URL de loopback não foi usado como prova de isolamento.

## Reprodução sem depender da pasta temporária desta sessão

Crie uma pasta temporária própria com o helper de tarefas; use o caminho retornado como `OWN_TEMP`. Recrie nela os quatro arquivos abaixo com os conteúdos fornecidos, substituindo `OWN_TEMP` nos caminhos. A pasta desta execução foi descartada após a verificação, portanto não deve ser reutilizada.

```powershell
powershell.exe -NoProfile -File C:\Users\samue\.codex\hooks\task-temp.ps1 -Action New -Workspace C:\Users\samue\Desktop\PerfectUtilitares-planejamento-20261113
```

`test-isolation.setup.ts`:

```ts
import { vi } from "vitest";
import { Socket } from "node:net";
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, {
  get(_target, property) { throw new Error(`ISOLATION_GUARD: unexpected Prisma access (${String(property)})`); },
}) }));
Object.defineProperty(Socket.prototype, "connect", {
  configurable: false, writable: false,
  value() { throw new Error("ISOLATION_GUARD: unexpected outbound socket connection"); },
});
globalThis.fetch = (() => { throw new Error("ISOLATION_GUARD: unexpected outbound fetch"); }) as typeof fetch;
```

`vitest.isolated.config.mts`:

```ts
import base from "C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113/web/vitest.config.ts";
const root = "C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113/web";
const own = "OWN_TEMP";
export default { ...base, root,
  resolve: { ...base.resolve, alias: { "@": root + "/src", "vitest": root + "/node_modules/vitest/dist/index.js" } },
  test: { ...base.test, setupFiles: [own + "/test-isolation.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", own + "/isolation-guard.test.ts"] },
};
```

`isolation-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Socket } from "node:net";
import { prisma } from "@/lib/prisma";
describe("process isolation guard", () => {
  it("rejects unexpected persistence before delegation", () => {
    expect(() => prisma.escalaModuleAccessPolicy.findUnique({ where: { tenantId: "synthetic" } })).toThrow("ISOLATION_GUARD");
    expect(() => prisma.$transaction).toThrow("ISOLATION_GUARD");
  });
  it("rejects network before connection", () => {
    const socket = new Socket();
    expect(() => socket.connect(1, "127.0.0.1")).toThrow("ISOLATION_GUARD");
    socket.destroy();
    expect(() => fetch("https://synthetic.invalid")).toThrow("ISOLATION_GUARD");
  });
});
```

`run-scoped.cjs` (mesma seleção e argumentos da execução final; o script apenas lê fontes e executa verificações):

```js
const fs = require("fs"), cp = require("child_process"), path = require("path");
const root = "C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113";
const own = __dirname.replaceAll("\\", "/");
const node = process.execPath;
const stems = ["access", "access.server", "access-contracts", "account-access-view.server", "module-session", "operator-session-issuer", "operator-session-store", "operator-admin-input", "operator-admin-service", "approved-policy", "approved-policy-service", "operational-input-policy", "proposal-proof", "service", "solve-operations", "route-policy", "export", "export-cache", "shift-catalog/catalog", "shift-catalog/swap", "shift-catalog/export"];
function walk(p, pattern) {
  return fs.readdirSync(root + "/web/" + p, { withFileTypes: true }).flatMap(d => {
    const f = p + "/" + d.name;
    return d.isDirectory() ? walk(f, pattern) : pattern.test(f) ? [f] : [];
  });
}
const tests = stems.map(s => "src/lib/escalas/" + s + ".test.ts").filter(f => fs.existsSync(root + "/web/" + f));
tests.push(...walk("src/app/api/escalas", /\.test\.ts$/), "src/app/(app)/escala/page.test.tsx", own + "/isolation-guard.test.ts");
function run(args, extraEnv = {}) {
  const r = cp.spawnSync(node, args, { cwd: root + "/web", env: { ...process.env, ...extraEnv }, encoding: "utf8", timeout: 120000 });
  const output = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "");
  console.log(output.split("\n").filter(l => /Test Files|Tests |FAIL |Error:|TypeError:|AssertionError:|Checked |error TS/.test(l)).join("\n"));
  console.log("exit", r.status);
  if (r.error || r.status !== 0) process.exitCode = 1;
}
const testDatabaseUrl = process.env.ESCALAS_TEST_DATABASE_URL;
if (!testDatabaseUrl || !URL.canParse(testDatabaseUrl)) throw new Error("Defina ESCALAS_TEST_DATABASE_URL para o teste simulado.");
const testDatabase = new URL(testDatabaseUrl);
if (testDatabase.protocol !== "postgresql:" || testDatabase.hostname !== "127.0.0.1" || testDatabase.port !== "1") {
  throw new Error("O teste simulado exige um PostgreSQL inacessível em 127.0.0.1:1.");
}
run(["node_modules/vitest/vitest.mjs", "run", "--config", own + "/vitest.isolated.config.mts", ...tests, "-t", "^(?!.*carries real Python-shaped)"], {
  DATABASE_URL: testDatabaseUrl, DATABASE_CONNECTION_TIMEOUT_MS: "100",
});
const owned = stems.flatMap(s => ["src/lib/escalas/" + s + ".ts", "src/lib/escalas/" + s + ".test.ts"]).filter(f => fs.existsSync(root + "/web/" + f));
owned.push(...walk("src/app/api/escalas", /\.ts$/), "src/app/(app)/escala/page.tsx", "src/app/(app)/escala/page.test.tsx");
run(["node_modules/@biomejs/biome/bin/biome", "lint", "--diagnostic-level=warn", "--error-on-warnings", ...owned]);
if (fs.existsSync(path.join(own, "tsconfig.backend.json"))) run(["node_modules/typescript/bin/tsc", "--noEmit", "--project", path.join(own, "tsconfig.backend.json")]);
```

Para reproduzir os tipos, crie ainda `tsconfig.backend.json`, com `extends` absoluto para `web/tsconfig.json`, `compilerOptions: { "incremental": false }`, `exclude: ["**/node_modules"]` e `include` absoluto para estes padrões sob `web/`:

```text
src/lib/escalas/access*.ts
src/lib/escalas/account-access-view.server*.ts
src/lib/escalas/module-session*.ts
src/lib/escalas/operator-*.ts
src/lib/escalas/approved-policy*.ts
src/lib/escalas/operational-input-policy*.ts
src/lib/escalas/proposal-proof*.ts
src/lib/escalas/service*.ts
src/lib/escalas/solve-operations*.ts
src/lib/escalas/route-policy*.ts
src/lib/escalas/export*.ts
src/lib/escalas/shift-catalog/catalog*.ts
src/lib/escalas/shift-catalog/swap*.ts
src/lib/escalas/shift-catalog/export*.ts
src/app/api/escalas/**/*.ts
```

Para reproduzir também o bloqueio da integração SSR, use uma cópia desse JSON incluindo os caminhos absolutos de `src/app/(app)/escala/page.tsx` e `page.test.tsx` e execute `tsc --noEmit --project` nessa cópia. Não altere a configuração global do projeto.

Execute com o Node embarcado verificado nesta entrega (em nova sessão, confirme sua disponibilidade pelo carregador de dependências):

```powershell
& 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt/dependencies/node/bin/node.exe' 'OWN_TEMP/run-scoped.cjs'
git -C C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113 diff --check
```

Ao terminar, complete somente a sua pasta, sem processos consumidores:

```powershell
powershell.exe -NoProfile -File C:\Users\samue\.codex\hooks\task-temp.ps1 -Action Complete -Workspace C:\Users\samue\Desktop\PerfectUtilitares-planejamento-20261113 -TaskPath OWN_TEMP
```

## Log preservado do bloqueio de tipos integrado

Diretório de execução: `C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113/web`.
Comando real (Node embarcado absoluto citado acima):

```text
node.exe node_modules/typescript/bin/tsc --noEmit --project C:/Users/samue/Desktop/PerfectUtilitares-planejamento-20261113/work/.codex-task-temp/e49c731e5a70459284c0295b81400091/tsconfig.functional.json
```

Configuração usada: `extends` absoluto para `web/tsconfig.json`, `compilerOptions.incremental=false`, os quinze padrões absolutos listados acima e os caminhos absolutos adicionais `web/src/app/(app)/escala/page.tsx` e `web/src/app/(app)/escala/page.test.tsx`; `exclude=["**/node_modules"]`. O backend usa exatamente essa configuração sem os dois caminhos SSR. Este log permanece no documento após a remoção da pasta de execução.

```text
src/components/escalas/operator-administration.tsx(60,63): error TS2322: Type '{ branchCode: string; active: boolean; capabilities: readonly ("access.manage" | "employee.manage" | "export.integration" | "export.schedule.pdf" | "export.schedule.xlsx" | "import.manage" | ... 9 more ... | "workspace.save")[]; }[]' is not assignable to type '{ branchCode: string; active: boolean; capabilities: ("employee.manage" | "export.schedule.pdf" | "export.schedule.xlsx" | "schedule.apply" | "schedule.generate" | "shift.manage" | "workspace.create" | "workspace.read" | "workspace.save")[]; }[]'.
  Type '{ branchCode: string; active: boolean; capabilities: readonly ("access.manage" | "employee.manage" | "export.integration" | "export.schedule.pdf" | "export.schedule.xlsx" | "import.manage" | ... 9 more ... | "workspace.save")[]; }' is not assignable to type '{ branchCode: string; active: boolean; capabilities: ("employee.manage" | "export.schedule.pdf" | "export.schedule.xlsx" | "schedule.apply" | "schedule.generate" | "shift.manage" | "workspace.create" | "workspace.read" | "workspace.save")[]; }'.
    Types of property 'capabilities' are incompatible.
      The type 'readonly ("access.manage" | "employee.manage" | "export.integration" | "export.schedule.pdf" | "export.schedule.xlsx" | "import.manage" | "report.analytics" | "schedule.apply" | "schedule.generate" | ... 6 more ... | "workspace.save")[]' is 'readonly' and cannot be assigned to the mutable type '("employee.manage" | "export.schedule.pdf" | "export.schedule.xlsx" | "schedule.apply" | "schedule.generate" | "shift.manage" | "workspace.create" | "workspace.read" | "workspace.save")[]'.
exit 1
```

## Liberação

Contrato r3 já liberado e preservado. Implementação funcional de acesso, rotas protegidas, catálogo/troca e exportação desta frente liberada para integração após esta entrega; limitações de tipos, PostgreSQL e E2E acima continuam gates explícitos de integração/liberação. Nenhuma autorização de produção é inferida deste relatório.
