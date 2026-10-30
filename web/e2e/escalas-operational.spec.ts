import { expect, test } from "./fixtures";
import { unzipSync, strFromU8 } from "fflate";
import { newEmployee, newInput } from "../src/components/escalas/workspace-model";
import type { EscalaWorkspace } from "../src/lib/escalas/types";
import { loginAsAdmin } from "./admin-session";

test.beforeEach(async ({ page }) => {
  test.skip(process.env.E2E_MUTATION !== "1", "Requires the disposable isolated database");
  test.setTimeout(180_000);
  await loginAsAdmin(page);
});

test("exact operational clocks, excluded relation, responsive graph and all three report choices use real saved API data", async ({ page }) => {
  const input = newInput("OPS-" + Date.now().toString(36), "Validação operacional", "2026-11", 42);
  const segments = [[576,840,960,1200], [580,810,930,1204], [616,900,990,1210]];
  input.shifts = segments.map(([start, meal, back, end], position) => ({ id: "s" + position, name: "Horário " + position, segments: [{start,end:meal,kind:"WORK"}, {start:meal,end:back,kind:"BREAK"}, {start:back,end,kind:"WORK"}] }));
  input.employees = segments.map((_, position) => ({ ...newEmployee(42, "s" + position), id: "p" + position, registration: "10" + position, name: "Pessoa " + position, sector: "Reposição", role: position === 2 ? "Encarregado" : "Repositor", scheduleMode: "TIMED", activeFrom: "" }));
  input.employees.push({ ...input.employees[0], id:"excluded", registration:"999", name:"Pessoa fora da proposta", planningEnabled:false, planningExclusionReason:"Exclusão manual de teste" });
  input.employees.push({ ...input.employees[0], id:"missing", registration:"998", name:"Horário não informado", scheduleMode:"MISSING", shiftIds:[] });
  input.assignments = input.employees.filter(person => person.planningEnabled !== false).map(person => ({employeeId:person.id,date:"2026-11-02",kind:person.id === "missing" ? "DUTY" : "WORK", ...(person.id !== "missing" ? {shiftId:person.shiftIds[0]} : {})}));
  input.assignments.push({employeeId:"p0",date:"2026-11-03",kind:"ABSENCE"});
  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/escalas", {headers:{origin},data:{action:"CREATE",input}});
  expect(response.status()).toBe(201);
  let workspace: EscalaWorkspace = await response.json();
  try {
    await page.goto("/escala");
    await page.getByLabel("Selecionar filial e período",{exact:true}).selectOption(workspace.id);
    const grade = page.locator('[aria-label="Grade mensal da equipe, com rolagem horizontal e vertical"]');
    await expect(grade).toBeVisible();
    await expect(grade).not.toContainText("Pessoa fora da proposta");
    await expect(grade).toContainText("09:36-14:00 / 16:00-20:00");
    await page.getByRole("button",{name:"Cobertura",exact:true}).click();
    await page.getByLabel("Data da cobertura",{exact:true}).selectOption("2026-11-02");
    await page.getByLabel("Setor no gráfico",{exact:true}).selectOption("Reposição");
    await expect(page.getByRole("img",{name:/Presença por horário/})).toBeVisible();
    // Independent clock arithmetic: these expected identities are not calculated by the product helper.
    const expectedPresence: [number, string[]][] = [[576,["p0"]],[580,["p0","p1"]],[616,["p0","p1","p2"]],[810,["p0","p2"]],[840,["p2"]],[900,[]],[930,["p1"]],[960,["p0","p1"]],[990,["p0","p1","p2"]],[1200,["p1","p2"]],[1204,["p2"]]];
    for(const [minute, ids] of expectedPresence) {
      await page.getByLabel("Faixa de horário e colaboradores",{exact:true}).selectOption(String(minute));
      const expected = workspace.input.employees.filter(person => ids.includes(person.id));
      await expect(page.getByRole("heading",{name:new RegExp(": " + expected.length + " trabalhando$")})).toBeVisible();
      const live = page.locator('[aria-live="polite"][aria-atomic="true"]').filter({has:page.getByRole("heading",{name:new RegExp(": " + expected.length + " trabalhando$")})});
      for(const person of expected) await expect(live).toContainText(person.name);
      await expect(live).not.toContainText("Pessoa fora da proposta");
      await expect(live).not.toContainText("Horário não informado");
    }
    for(const width of [375,768,1280]) {await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
    await page.getByRole("button",{name:"Escala",exact:true}).click();
    for(const mode of ["rest","hours","both"]) {
      await page.getByLabel("Conteúdo do PDF e XLSX",{exact:true}).selectOption(mode);
      await expect(page.getByLabel("Visualização da escala",{exact:true})).toHaveValue(mode);
      if(mode==="hours") await expect(grade).toHaveCount(0); else await expect(grade).toBeVisible();
      for(const format of ["pdf","xlsx"]) {
        const exporting=page.waitForResponse(r=>r.url().includes("/api/escalas/export") && r.url().includes("format="+format));
        await page.getByRole("button",{name:"Gerar "+format.toUpperCase(),exact:true}).click();
        await expect(page.getByRole("link",{name:"Baixar "+format.toUpperCase(),exact:true})).toBeVisible();
        const downloading=page.waitForEvent("download");
        await page.getByRole("link",{name:"Baixar "+format.toUpperCase(),exact:true}).click();
        const exported=await exporting;expect(exported.status()).toBe(200);expect(new URL(exported.url()).searchParams.get("mode")).toBe(mode);
        const download=await downloading;expect(await download.failure()).toBeNull();
        const stream=await download.createReadStream();if(!stream)throw Error("Missing report stream");
        const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks);
        expect(bytes.length).toBeGreaterThan(1000);
        if(format==="xlsx") {const files=unzipSync(bytes),book=strFromU8(files["xl/workbook.xml"]);expect(book.includes('name="Escala"')).toBe(mode!=="hours");expect(book.includes('name="Horarios"')).toBe(mode!=="rest");expect(book).toContain('name="Excluidos"');}
        else expect(bytes.subarray(0,4).toString()).toBe("%PDF");
        await download.delete();
      }
    }
    expect((await page.request.get("/api/escalas?id="+workspace.id).then(r=>r.json())).input).toEqual(workspace.input);
  } finally {
    workspace=await page.request.get("/api/escalas?id="+workspace.id).then(r=>r.json());
    expect((await page.request.delete("/api/escalas",{headers:{origin},data:{workspaceId:workspace.id,expectedRevision:workspace.revision}})).status()).toBe(200);
  }
});

test("short-journey pause flexibility requires an explicit scenario choice, survives save and never changes another plan", async ({ page }) => {
  const origin=new URL(page.url()).origin,ids:string[]=[];
  try {
    const input=newInput("PAUSA-"+Date.now().toString(36),"Simulação de pausa","2026-11",42);
    input.employees=[{...newEmployee(42,"short"),id:"short-person",registration:"1",name:"Pessoa jornada curta",sector:"Loja",role:"Apoio",simulationDailyMinutes:300,activeFrom:""}];
    input.shifts=[{id:"short",name:"Cinco horas sem pausa",segments:[{start:480,end:780,kind:"WORK"}]}];
    const create=await page.request.post("/api/escalas",{headers:{origin},data:{action:"CREATE",input}});expect(create.status()).toBe(201);let workspace:EscalaWorkspace=await create.json();ids.push(workspace.id);
    const generate=async()=>{const response=await page.request.post("/api/escalas",{headers:{origin},data:{action:"GENERATE",id:workspace.id,expectedRevision:workspace.revision}});expect(response.status()).toBe(200);return response;};
    expect((await (await generate()).json()).result.status).toBe("INFEASIBLE");
    await page.goto("/escala");await page.getByLabel("Selecionar filial e período",{exact:true}).selectOption(workspace.id);
    await page.getByRole("button",{name:"Ajustes",exact:true}).click();
    await page.getByRole("button",{name:"Intervalos de jornadas curtas",exact:true}).click();
    const toggle=page.getByRole("checkbox",{name:"Simular jornadas de 4 a 6 horas sem pausa",exact:true});
    await expect(toggle).not.toBeChecked();await toggle.check();
    const saving=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().endsWith("/api/escalas")&&r.request().postDataJSON()?.action==="SAVE");
    await expect(page.locator('[data-state="saved"]')).toBeVisible();expect((await saving).status()).toBe(200);
    workspace=await page.request.get("/api/escalas?id="+workspace.id).then(r=>r.json());expect(workspace.input.policy.allowShortMealSimulation).toBe(true);
    const generated=await (await generate()).json();expect(["FEASIBLE","OPTIMAL"]).toContain(generated.result.status);expect(generated.validation.valid).toBe(true);expect(generated.validation.readyToPublish).toBe(false);
    expect(generated.validation.issues.some((issue:{code:string})=>issue.code==="SIMULATION_SHORT_MEAL_FLEX")).toBe(true);
    expect(generated.proposalInput.policy.maxConsecutiveWorkDays).toBe(5);
    expect(generated.proposalInput.shifts[0].segments).toEqual(input.shifts[0].segments);
    const other=newInput("OUTRA-PAUSA-"+Date.now().toString(36),"Outra simulação","2026-11",42);
    const second=await page.request.post("/api/escalas",{headers:{origin},data:{action:"CREATE",input:other}});expect(second.status()).toBe(201);const separate:EscalaWorkspace=await second.json();ids.push(separate.id);expect(separate.input.policy.allowShortMealSimulation).not.toBe(true);
  } finally {for(const id of ids){const workspace:EscalaWorkspace=await page.request.get("/api/escalas?id="+id).then(r=>r.json());expect((await page.request.delete("/api/escalas",{headers:{origin},data:{workspaceId:id,expectedRevision:workspace.revision}})).status()).toBe(200);}}
});
