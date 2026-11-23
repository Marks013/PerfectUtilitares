import { describe, expect, it } from "vitest";
import { dismissEscalaWorkforcePerson, type EscalaWorkforceSnapshot, projectEscalaWorkforceDraft } from "./global-workforce-domain";
import { applyEscalaWorkforceFpre136 } from "./global-workforce-team-import";
import { previewEscalaRows } from "./import";

const startDate = "2026-12-01";
const endDate = "2026-12-31";
const empty: EscalaWorkforceSnapshot = { version: 1, people: [], catalogs: [], absences: [] };
const header = [["0001", "-", "Empresa", "Pág.:", "1"], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"]];
type Person = { registration: string; untimed?: boolean };
type Team = { branch: string; people: Person[] };

function previews(teams: Team[], tail: string[][] = []) {
  const rows = [...header, ...teams.flatMap(({ branch, people }) => [
    [`${branch}.01 , FILIAL SINTÉTICA, LOJA`],
    ["Horário:", "0026", "-", "Referência"],
    ...people.flatMap(({ registration, untimed }) => {
      const [start, pause, resume, end] = untimed ? ["00:00", "00:00", "00:00", "00:00"] : ["07:00", "11:00", "13:00", "16:20"];
      return [
        [registration, "-", "Pessoa sintética", "Operador", start, "-", pause, resume, "-", end],
        ["Sábado:", start, "-", pause, resume, "-", end, start, "0026"],
      ];
    }),
  ]), ...tail];
  return teams.map(({ branch }) => previewEscalaRows(rows, { branchCode: branch, startDate, defaultWeeklyHours: 42 }));
}

const apply = (snapshot: EscalaWorkforceSnapshot, teams: Team[]) =>
  applyEscalaWorkforceFpre136(snapshot, previews(teams), teams.map(({ branch }) => branch));

describe("importação global da equipe FPRE136", () => {
  it("mantém matrícula e ID na mudança entre filiais do mesmo lote e guarda a admissão conhecida", () => {
    const original = apply(empty, [
      { branch: "02", people: [{ registration: "0007" }, { registration: "0008" }] },
      { branch: "06", people: [{ registration: "0009" }] },
      { branch: "18", people: [{ registration: "0010" }] },
    ]);
    const originalPerson = original.people.find(({ employee }) => employee.registration === "0007");
    if (!originalPerson) throw new Error("Cadastro sintético ausente");
    originalPerson.employee.activeFrom = "2026-12-03";
    originalPerson.employee.weeklyHours = 44;
    originalPerson.employee.weeklyHoursMode = "INDIVIDUAL";
    original.absences.push({ registration: "0007", startDate: "2026-12-05", endDate: "2026-12-06", source: "MANUAL" });
    const originalCopy = structuredClone(original);
    const moved = apply(original, [
      { branch: "02", people: [{ registration: "0008" }] },
      { branch: "06", people: [{ registration: "0007", untimed: true }, { registration: "0009" }] },
    ]);
    expect(moved.people.find(({ employee }) => employee.registration === "0007")).toMatchObject({
      branchCode: "06", dismissedFrom: null, employee: {
        id: originalPerson.employee.id, registration: "0007", activeFrom: "2026-12-03",
        weeklyHours: 44, weeklyHoursMode: "INDIVIDUAL", scheduleMode: "UNTIMED", shiftIds: [],
        sourceSchedule: { report: "FPRE136", weekday: "00:00-00:00 / 00:00-00:00" },
      },
    });
    const origin = projectEscalaWorkforceDraft(moved, "02", startDate, endDate);
    const destination = projectEscalaWorkforceDraft(moved, "06", startDate, endDate);
    expect(origin.employees.map(person => person.registration)).toEqual(["0008"]);
    expect(origin.absenceDates.size).toBe(0);
    expect(destination.employees.map(person => person.registration)).toEqual(["0007", "0009"]);
    expect(destination.absenceDates.get("0007")).toEqual(new Set(["2026-12-05", "2026-12-06"]));
    expect(moved.people.find(({ branchCode }) => branchCode === "18")).toEqual(original.people.find(({ branchCode }) => branchCode === "18"));
    expect(original).toEqual(originalCopy);
  });

  it("guarda a identidade e o afastamento de quem sai da lista, sem inventar desligamento", () => {
    const first = { branch: "02", people: [{ registration: "0007" }, { registration: "0008" }] };
    const original = apply(empty, [first]);
    original.absences.push({ registration: "0007", startDate, endDate: null, source: "FPHI105" });
    const second = { branch: "02", people: [{ registration: "0008" }] };
    const removed = apply(original, [second]);
    expect(removed.people.find(({ employee }) => employee.registration === "0007")).toMatchObject({
      listed: false, dismissedFrom: null, employee: { id: original.people[0].employee.id, registration: "0007" },
    });
    expect(removed.absences).toEqual(original.absences);
    const projected = projectEscalaWorkforceDraft(removed, "02", startDate, endDate);
    expect(projected.employees.map(person => person.registration)).toEqual(["0008"]);
    expect(projected.absenceDates.size).toBe(0);
    const listedAgain = apply(removed, [first]);
    expect(listedAgain.people.find(({ employee }) => employee.registration === "0007")?.listed).toBeUndefined();
    expect(projectEscalaWorkforceDraft(listedAgain, "02", startDate, endDate).absenceDates.get("0007")?.size).toBe(31);
  });

  it("não reativa pessoa desligada ao reencontrá-la no arquivo e não cria revisão para repetição exata", () => {
    const team = { branch: "02", people: [{ registration: "0007" }] };
    const original = apply(empty, [team]);
    const dismissed = dismissEscalaWorkforcePerson(original, "0007", "2026-12-15");
    expect(apply(dismissed, [team])).toBe(dismissed);
    expect(projectEscalaWorkforceDraft(dismissed, "02", "2026-12-15", endDate).employees).toEqual([]);
  });

  it("bloqueia seleção parcial, linha truncada, transferência sem origem e colisões de matrícula", () => {
    const a = { branch: "02", people: [{ registration: "0007" }] };
    const b = { branch: "06", people: [{ registration: "0008" }] };
    const source = apply(empty, [a, b]);
    const original = structuredClone(source);
    const complete = previews([a, b]);
    const code = { code: "ESCALA_WORKFORCE_INCOMPLETE_TEAM" };
    expect(() => applyEscalaWorkforceFpre136(source, [complete[0]], ["02"]))
      .toThrowError(expect.objectContaining(code));
    expect(() => applyEscalaWorkforceFpre136(source, previews([a, b], [["0009", "-", "Truncada"]]), ["02", "06"]))
      .toThrowError(expect.objectContaining(code));
    expect(() => apply(source, [{ branch: "06", people: [{ registration: "0007" }] }]))
      .toThrowError(expect.objectContaining(code));
    expect(() => apply(source, [a, { branch: "06", people: [{ registration: "0007" }] }]))
      .toThrowError(expect.objectContaining(code));
    expect(() => apply(source, [{ branch: "02", people: [{ registration: "7" }] }]))
      .toThrowError(expect.objectContaining(code));
    expect(source).toEqual(original);
  });

  it("rejeita códigos de turno duplicados ou com outra geometria no catálogo da filial", () => {
    const team = { branch: "02", people: [{ registration: "0007" }] };
    const source = apply(empty, [team]);
    const original = structuredClone(source);
    const [duplicate] = previews([team]);
    duplicate.shifts.push(duplicate.shifts[0]);
    const code = { code: "ESCALA_WORKFORCE_INCOMPLETE_TEAM" };
    expect(() => applyEscalaWorkforceFpre136(source, [duplicate], ["02"])).toThrowError(expect.objectContaining(code));
    const [conflict] = previews([team]);
    conflict.shifts[0].segments[0].start += 30;
    expect(() => applyEscalaWorkforceFpre136(source, [conflict], ["02"])).toThrowError(expect.objectContaining(code));
    expect(source).toEqual(original);
  });
});
