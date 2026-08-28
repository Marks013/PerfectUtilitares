import { describe, expect, it, vi } from "vitest";
import type { FeriasSnapshot } from "./contracts";
import { choicesSchema } from "./contracts";
import { buildFeriasAnalysis } from "./service";
import type { FeriasInputRow } from "./workbook";

vi.mock("./repository", () => ({ readFeriasSnapshot: vi.fn() }));

const input: FeriasInputRow[] = [{ row: 4, registration: "0042", branch: "P", name: "PESSOA EXEMPLO",
  start: "2026-09-01", end: "2026-09-30", days: 30, highlight: false }];
function snapshot(): FeriasSnapshot {
  return {
    revision: "source-a", sources: [{ name: "Cadastro Unimed", ready: true, competency: "2026-09", fallback: false },
      { name: "Fatura e coparticipação", ready: true, competency: "2026-09", fallback: false },
      { name: "Consignado Digital", ready: true, competency: "2026-09", fallback: false }],
    beneficiaries: [{ id: "holder", holderId: null, registration: "42", fullName: "PESSOA EXEMPLO",
      cpf: "52998224725", branchId: "branch", category: "HOLDER", birthDate: "1990-01-01", planCode: "1" },
      { id: "dependent", holderId: "holder", registration: null, fullName: "DEPENDENTE EXEMPLO",
        cpf: null, branchId: "branch", category: "DEPENDENT", birthDate: "2010-01-01", planCode: "1" }],
    invoices: [
      { id: "i1", beneficiaryId: "holder", branchId: "branch", beneficiaryName: "PESSOA EXEMPLO",
        holderName: "PESSOA EXEMPLO", category: "HOLDER", itemDescription: "MENSALIDADE", amount: "999.00" },
      { id: "i2", beneficiaryId: "dependent", branchId: "branch", beneficiaryName: "DEPENDENTE EXEMPLO",
        holderName: "PESSOA EXEMPLO", category: "DEPENDENT", itemDescription: "MENSALIDADE", amount: "203.71" },
      { id: "i3", beneficiaryId: "holder", branchId: "branch", beneficiaryName: "PESSOA EXEMPLO",
        holderName: "PESSOA EXEMPLO", category: "HOLDER", itemDescription: "ADITIVO", amount: "6.12" },
      { id: "i4", beneficiaryId: "holder", branchId: "branch", beneficiaryName: "PESSOA EXEMPLO",
        holderName: "PESSOA EXEMPLO", category: "HOLDER", itemDescription: "COPARTICIPACAO", amount: "321.00" },
    ],
    loans: [{ id: "loan", beneficiaryId: "holder", registration: "INCOMPATIVEL", employeeName: "PESSOA EXEMPLO",
      cpfNormalized: "52998224725", contractNumber: "A", installmentAmount: "0.10", competence: "2026-09",
      startCompetence: "2026-01", endCompetence: "2027-12", bankCode: "1", companyCnpj: null },
      { id: "loan2", beneficiaryId: "holder", registration: "INCOMPATIVEL", employeeName: "PESSOA EXEMPLO",
        cpfNormalized: "52998224725", contractNumber: "B", installmentAmount: "0.20", competence: "2026-09",
        startCompetence: "2026-01", endCompetence: "2027-12", bankCode: "1", companyCnpj: null }],
    prices: [{ id: "price", planCode: "1", employeeAmount: "61.26", companyAmount: "213.39",
      validFrom: "2026-08-01", validTo: null, ageBracket: { code: "34-38", minAge: 34, maxAge: 38 } }],
  };
}
const analyze = (data = snapshot()) => buildFeriasAnalysis(data, input, "2026-09", [], "file-hash");

describe("Férias: competência, identidade e valores", () => {
  it("manual selection of the CPF-less group cannot omit identified installments", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = [];
    data.branches = [{ code: "HIPER", cnpj: "76361807000111" }];
    for (const loan of data.loans) { loan.registration = "BANK3158"; loan.companyCnpj = "76361807000111"; }
    data.loans[1].cpfNormalized = null;
    const result = buildFeriasAnalysis(data, input, "2026-09", [{ row: 4, loanIdentity: "loan2" }], "file");
    expect(result.canExport).toBe(false);
    expect(result.rows[0].loanText).toBe("");
  });
  it("uses the registered holder full name to find CPF-less contracts despite an abbreviated input", () => {
    const data = snapshot(); data.beneficiaries[0].fullName = "PESSOA EXEMPLO DE OLIVEIRA";
    for (const loan of data.loans) { loan.employeeName = data.beneficiaries[0].fullName; loan.registration = "BANK3158"; }
    data.loans[1].cpfNormalized = null;
    const result = analyze(data);
    expect(result.rows[0].loanCandidates).toHaveLength(2);
    expect(result.canExport).toBe(false);
    expect(result.rows[0].issues.join(" ")).toContain("nenhuma parcela");
  });
  it("blocks a contradictory loan CNPJ even when name and registration agree", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = [];
    data.branches = [{ code: "HIPER", cnpj: "76361807000111" }];
    for (const loan of data.loans) { loan.registration = "42"; loan.companyCnpj = "76361807000898"; }
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.rows[0].loanText).toBe("");
    expect(result.rows[0].issues.join(" ")).toContain("CNPJ");
  });
  it("does not drop same-person installments lacking CPF during company matching", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = [];
    data.branches = [{ code: "HIPER", cnpj: "76361807000111" }];
    for (const loan of data.loans) { loan.registration = "BANK3158"; loan.companyCnpj = "76361807000111"; }
    data.loans[1].cpfNormalized = null;
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.rows[0].loanText).toBe("");
    expect(result.rows[0].loanCandidates).toHaveLength(2);
  });
  it("does not drop same-person installments lacking CPF when holder CPF matches", () => {
    const data = snapshot(); data.loans[1].cpfNormalized = null;
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.rows[0].loanText).toBe("");
    expect(result.rows[0].issues.join(" ")).toContain("nenhuma parcela");
  });
  it("ignores unrelated registration collisions in another company", () => {
    const data = snapshot(); data.branches = [{ code: "HIPER", cnpj: "76361807000111" }];
    data.loans.push({ ...data.loans[0], id: "unrelated", registration: "42", employeeName: "OUTRA PESSOA",
      cpfNormalized: "11144477735", companyCnpj: "76361807000898" });
    const result = analyze(data);
    expect(result.canExport).toBe(true);
    expect(result.rows[0].loanText).toBe("Consig.R$ 0,30");
  });
  it("includes registered dependent invoices with neither beneficiaryId nor holderName", () => {
    const data = snapshot(); data.invoices[1].beneficiaryId = null; data.invoices[1].holderName = null;
    const result = analyze(data);
    expect(result.canExport).toBe(true);
    expect(result.rows[0].unimedText).toBe("Mens.: 264,97 + Adit.: 6,12");
  });
  it("blocks ambiguous orphan invoices instead of silently omitting them", () => {
    const data = snapshot(); data.invoices[1].beneficiaryId = null; data.invoices[1].holderName = null;
    data.beneficiaries.push({ ...data.beneficiaries[1], id: "other", holderId: "other-family" });
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.rows[0].unimedText).toBe("");
  });
  it("uses exact full name, unique CPF and branch CNPJ for bank-specific registrations", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = [];
    data.branches = [{ code: "HIPER", cnpj: "76.361.807/0001-11" }];
    for (const loan of data.loans) { loan.registration = "BANK0003158"; loan.companyCnpj = "76361807000111"; }
    const result = analyze(data);
    expect(result.canExport).toBe(true);
    expect(result.rows[0].loanText).toBe("Consig.R$ 0,30");
    expect(result.rows[0].warnings.join(" ")).toContain("CNPJ da filial");
  });
  it("does not use company evidence when CPF, branch or comparable registration contradicts it", () => {
    for (const kind of ["cpf", "branch", "registration", "homonym"]) {
      const data = snapshot(); data.beneficiaries = []; data.invoices = [];
      data.branches = [{ code: "HIPER", cnpj: "76361807000111" }];
      for (const loan of data.loans) { loan.registration = "BANK0003158"; loan.companyCnpj = "76361807000111"; }
      if (kind === "cpf") for (const loan of data.loans) loan.cpfNormalized = null;
      if (kind === "branch") data.branches[0].code = "MATRIZ";
      if (kind === "registration") for (const loan of data.loans) loan.registration = "999";
      if (kind === "homonym") data.loans.push({ ...data.loans[0], id: "other", cpfNormalized: "11144477735" });
      expect(analyze(data).canExport, kind).toBe(false);
      expect(analyze(data).rows[0].loanIdentity, kind).toBeUndefined();
    }
  });
  it("reconciles registration 5 invoice-only dependents without changing source records", () => {
    const data = snapshot();
    data.beneficiaries = [{ ...data.beneficiaries[0], registration: "5" }];
    data.invoices[1] = { ...data.invoices[1], beneficiaryId: null, amount: "692.76" };
    data.invoices.push({ ...data.invoices[1], id: "addon-dependent", itemDescription: "ADITIVO", amount: "6.12" });
    const before = JSON.stringify(data);
    const result = buildFeriasAnalysis(data, [{ ...input[0], registration: "0005" }], "2026-09", [], "file");
    expect(result.canExport).toBe(true);
    expect(result.rows[0].unimedText).toBe("Mens.: 754,02 + Adit.: 12,24");
    expect(result.rows[0].warnings.some((warning) => warning.includes("conciliadas"))).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
  });
  it("reconciles a missing invoice link to a unique registered dependent", () => {
    const data = snapshot(); data.invoices[1].beneficiaryId = null;
    expect(analyze(data).rows[0].unimedText).toBe("Mens.: 264,97 + Adit.: 6,12");
    expect(analyze(data).canExport).toBe(true);
  });
  it("blocks invoice-only dependents without a billed holder anchor", () => {
    const data = snapshot(); data.invoices[1].beneficiaryId = null;
    data.invoices = data.invoices.filter((item) => item.id !== "i1");
    expect(analyze(data).canExport).toBe(false);
  });
  it("blocks invoice reconciliation for same-branch homonymous holders", () => {
    const data = snapshot(); data.invoices[1].beneficiaryId = null;
    data.beneficiaries.push({ ...data.beneficiaries[0], id: "other-holder", registration: "999" });
    const result = buildFeriasAnalysis(data, input, "2026-09", [{ row: 4, holderId: "holder" }], "file");
    expect(result.canExport).toBe(false);
    expect(result.rows[0].issues.join(" ")).toContain("família");
  });
  it("never reconciles a dependent registered in another family", () => {
    const data = snapshot(); data.invoices[1].beneficiaryId = null;
    data.beneficiaries[1].holderId = "other-holder";
    expect(analyze(data).canExport).toBe(false);
  });
  it("never overrides an existing contradictory beneficiary link", () => {
    const data = snapshot(); data.invoices[1].beneficiaryId = "foreign-person";
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.rows[0].issues.join(" ")).toContain("outra pessoa ou filial");
  });
  it("detects duplicates after reconciling linked and unlinked invoices", () => {
    const data = snapshot(); data.invoices.push({ ...data.invoices[1], id: "duplicate", beneficiaryId: null });
    expect(analyze(data).canExport).toBe(false);
    expect(analyze(data).rows[0].issues.join(" ")).toContain("repetido");
  });
  it("uses registration and branch to disambiguate homonymous holders", () => {
    const data = snapshot(); data.beneficiaries[0].branchCode = "HIPER";
    data.beneficiaries.push({ ...data.beneficiaries[0], id: "other", branchId: "other-branch", branchCode: "M" });
    expect(analyze(data).canExport).toBe(true);
    expect(analyze(data).rows[0].holderId).toBe("holder");
  });
  it("does not auto-select duplicate registrations in the same branch", () => {
    const data = snapshot(); data.beneficiaries[0].branchCode = "P";
    data.beneficiaries.push({ ...data.beneficiaries[0], id: "other" });
    expect(analyze(data).canExport).toBe(false);
    expect(analyze(data).rows[0].holderId).toBeUndefined();
  });
  it("does not automatically ignore a contradictory branch", () => {
    const data = snapshot(); data.beneficiaries[0].branchCode = "M";
    expect(analyze(data).canExport).toBe(false);
    expect(analyze(data).rows[0].holderId).toBeUndefined();
  });
  it("uses exact name and branch only when the source has no registration", () => {
    const data = snapshot(); data.beneficiaries[0].registration = null; data.beneficiaries[0].branchCode = "P";
    expect(analyze(data).canExport).toBe(true);
  });
  it("normalizes accents, punctuation, spacing and padded registrations", () => {
    const data = snapshot(); data.beneficiaries[0].fullName = "Pessóa Exemplo.";
    for (const loan of data.loans) { loan.cpfNormalized = null; loan.registration = "00042"; loan.employeeName = " Pessóa   Exemplo. "; }
    expect(analyze(data).canExport).toBe(true);
    expect(analyze(data).rows[0].loanText).toBe("Consig.R$ 0,30");
  });
  it("shows registration-only loans for confirmation instead of silently omitting them", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = [];
    for (const loan of data.loans) { loan.registration = "42"; loan.employeeName = "OUTRO NOME"; loan.cpfNormalized = null; }
    const result = analyze(data);
    expect(result.rows[0].loanCandidates).toHaveLength(1);
    expect(result.rows[0].loanIdentity).toBeUndefined();
    expect(result.canExport).toBe(false);
    expect(result.rows[0].issues.join(" ")).toContain("nome diferente");
  });
  it("uses registered titular price, dependent monthly amounts and independent addons, not procedures", () => {
    const result = analyze();
    expect(result.canExport).toBe(true);
    expect(result.rows[0].unimedText).toBe("Mens.: 264,97 + Adit.: 6,12");
    expect(result.rows[0].loanText).toBe("Consig.R$ 0,30");
    expect(result.competency).toBe("2026-09");
  });
  it("reads employeeAmount changes from registered table instead of a hardcoded amount", () => {
    const data = snapshot();
    data.prices[0].employeeAmount = "54.21";
    expect(analyze(data).rows[0].unimedText).toBe("Mens.: 257,92 + Adit.: 6,12");
  });
  it("auto-confirms a unique registration even when the spreadsheet name is abbreviated", () => {
    const data = snapshot();
    data.beneficiaries[0].fullName = "PESSOA EXEMPLO DE OLIVEIRA";
    const result = analyze(data);
    expect(result.canExport).toBe(true);
    expect(result.rows[0]).toMatchObject({
      holderId: "holder",
      loanIdentity: "loan",
      loanText: "Consig.R$ 0,30",
      issues: [],
    });
    expect(result.rows[0].warnings).toContain(
      "Titular confirmado pela matrícula; o nome na planilha difere do cadastro Unimed.",
    );
  });
  it("auto-confirms a unique Consignado registration when CPF cannot resolve it", () => {
    const data = snapshot();
    data.beneficiaries = [];
    data.invoices = [];
    for (const loan of data.loans) {
      loan.cpfNormalized = null;
      loan.registration = "42";
    }
    const result = analyze(data);
    expect(result.canExport).toBe(true);
    expect(result.rows[0].loanIdentity).toBe("loan");
    expect(result.rows[0].loanText).toBe("Consig.R$ 0,30");
    expect(result.rows[0].issues).toEqual([]);
  });
  it("requires confirmation for exact-name loans without Unimed", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = [];
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.rows[0].loanCandidates).toHaveLength(1);
    expect(result.rows[0].issues).toContain("O Consignado foi localizado somente pelo nome. Confirme a pessoa correta na lista desta linha.");
    const confirmed = buildFeriasAnalysis(data, input, "2026-09", [{ row: 4, loanIdentity: "loan" }], "file-hash");
    expect(confirmed.canExport).toBe(true);
    expect(confirmed.rows[0].unimedText).toBe("");
    expect(confirmed.rows[0].loanText).toBe("Consig.R$ 0,30");
  });
  it("distinguishes empty published bases from missing sources and still analyzes available benefits", () => {
    const data = snapshot(); data.loans = [];
    expect(analyze(data).canExport).toBe(true);
    data.sources[2].ready = false;
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.rows[0].unimedText).not.toBe("");
  });
  it("leaves both fields empty when no benefit is located", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = []; data.loans = []; data.prices = [];
    const result = analyze(data);
    expect(result.canExport).toBe(true);
    expect(result.rows[0].warnings).toContain("Nenhum valor de Unimed ou Consignado foi localizado nas bases informadas acima.");
  });
  it("blocks absent table, ambiguous dependents and repeated monthly billings", () => {
    const noPrices = snapshot(); noPrices.prices = [];
    expect(analyze(noPrices).canExport).toBe(false);
    const unlinked = snapshot(); unlinked.invoices[1].beneficiaryId = null; unlinked.invoices[1].branchId = null;
    expect(analyze(unlinked).canExport).toBe(false);
    const duplicated = snapshot(); duplicated.invoices.push({ ...duplicated.invoices[1], id: "duplicate" });
    expect(analyze(duplicated).canExport).toBe(false);
  });
  it("never accepts previous-month loans and rejects repeated loan contracts", () => {
    const oldLoan = snapshot(); oldLoan.loans[0].competence = "2026-08";
    expect(analyze(oldLoan).canExport).toBe(false);
    const duplicate = snapshot(); duplicate.loans[1].contractNumber = "A";
    expect(analyze(duplicate).rows[0].loanText).toBe("");
  });
  it("accepts the previous month only for complete Unimed sources", () => {
    const data = snapshot();
    data.sources[0] = { ...data.sources[0], competency: "2026-08", fallback: true };
    data.sources[1] = { ...data.sources[1], competency: "2026-08", fallback: true };
    const result = analyze(data);
    expect(result.canExport).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.sources[2]).toMatchObject({ competency: "2026-09", fallback: false });
  });
  it("explains incomplete Unimed fallback and blocks missing exact-month loans", () => {
    const data = snapshot();
    data.sources[0] = { ...data.sources[0], ready: false, competency: "2026-08", fallback: true };
    data.sources[1] = { ...data.sources[1], ready: false, competency: "2026-08", fallback: true };
    data.sources[2].ready = false;
    const result = analyze(data);
    expect(result.canExport).toBe(false);
    expect(result.issues[0]).toContain("09/2026 nem em 08/2026");
    expect(result.issues[1]).toContain("não usa o mês anterior");
  });
  it("rejects a selection from another tenant/file and requires confirmation for name-only holder", () => {
    expect(() => buildFeriasAnalysis(snapshot(), input, "2026-09", [{ row: 4, holderId: "foreign" }], "f")).toThrow();
    expect(() => buildFeriasAnalysis(snapshot(), input, "2026-09", [{ row: 8, holderId: "holder" }], "f")).toThrow();
    const data = snapshot(); data.beneficiaries[0].registration = "999";
    expect(analyze(data).canExport).toBe(false);
    expect(analyze(data).rows[0].issues).toContain("A matrícula não confirmou o titular localizado pelo nome. Escolha a pessoa correta na lista Unimed desta linha.");
    expect(buildFeriasAnalysis(data, input, "2026-09", [{ row: 4, holderId: "holder" }], "f").canExport).toBe(true);
  });
  it("blocks a contradictory CPF even for an exact matching name", () => {
    const data = snapshot(); for (const loan of data.loans) loan.cpfNormalized = "11144477735";
    expect(analyze(data).canExport).toBe(false);
  });
  it("does not merge same-name loans from distinct companies without a reliable CPF", () => {
    const data = snapshot(); data.beneficiaries = []; data.invoices = [];
    data.loans[0].cpfNormalized = null; data.loans[1].cpfNormalized = null;
    data.loans[0].companyCnpj = "11111111000111"; data.loans[1].companyCnpj = "22222222000122";
    const result = analyze(data);
    expect(result.rows[0].loanCandidates).toHaveLength(2);
    expect(result.canExport).toBe(false);
    const selected = buildFeriasAnalysis(data, input, "2026-09", [{ row: 4, loanIdentity: "loan" }], "f");
    expect(selected.rows[0].loanText).toBe("Consig.R$ 0,10");
  });
  it("blocks duplicated funeral accessory amounts instead of adding them twice", () => {
    const data = snapshot(); data.invoices.push({ ...data.invoices[2], id: "another-addon" });
    expect(analyze(data).canExport).toBe(false);
  });
  it("binds revision to source versions, file and confirmations", () => {
    const first = analyze(); const data = snapshot(); data.revision = "source-b";
    expect(analyze(data).revision).not.toBe(first.revision);
    expect(buildFeriasAnalysis(snapshot(), input, "2026-09", [], "new-file").revision).not.toBe(first.revision);
    expect(buildFeriasAnalysis(snapshot(), input, "2026-09", [{ row: 4, holderId: "holder" }], "file-hash").revision).not.toBe(first.revision);
    expect(analyze().revision).toBe(first.revision);
  });
  it("rejects duplicate and unknown choice fields", () => {
    expect(choicesSchema.safeParse([{ row: 4 }, { row: 4 }]).success).toBe(false);
    expect(choicesSchema.safeParse([{ row: 4, amount: 1 }]).success).toBe(false);
  });
});
