import type {
  JornadaBatchLine,
  JornadaBatchReport,
} from "./batch-types";

export function formatBatchLineLabel(line: Pick<JornadaBatchLine, "matricula" | "nome">) {
  const matricula = line.matricula.trim();
  const nome = line.nome.trim();

  if (matricula && nome) return `${matricula} - ${nome}`;
  return nome || matricula || "-";
}

function batchLinePersonKey(line: Pick<JornadaBatchLine, "matricula" | "nome">) {
  return `${line.matricula.trim().toUpperCase()}|${line.nome.trim().toUpperCase()}`;
}

export function getBatchDetailedScheduleGroups(report: JornadaBatchReport) {
  const byPerson = new Map<
    string,
    { principal?: JornadaBatchLine; sabado?: JornadaBatchLine }
  >();

  report.linhas
    .filter((line) => line.jornadaCompleta && line.horarios.length >= 2)
    .forEach((line) => {
      const key = batchLinePersonKey(line);
      const current = byPerson.get(key) ?? {};

      if (line.linhaSabado) {
        current.sabado ??= line;
      } else {
        current.principal ??= line;
      }

      byPerson.set(key, current);
    });

  const collaborators = [...byPerson.values()].map((entry) => {
    const principal = entry.principal ?? entry.sabado;
    const sabado = entry.sabado;

    return {
      identificacao: principal ? formatBatchLineLabel(principal) : "-",
      nome: principal?.nome ?? "",
      matricula: principal?.matricula ?? "",
      horarioPrincipal: principal?.jornadaCompleta ?? "-",
      horarioSabado: sabado?.jornadaCompleta ?? "",
    };
  });

  const groups = new Map<string, typeof collaborators>();
  collaborators.forEach((collaborator) => {
    const list = groups.get(collaborator.horarioPrincipal) ?? [];
    list.push(collaborator);
    groups.set(collaborator.horarioPrincipal, list);
  });

  return [...groups.entries()]
    .map(([horarioPrincipal, colaboradores]) => ({
      horarioPrincipal,
      colaboradores: colaboradores.sort(
        (a, b) =>
          a.nome.localeCompare(b.nome, "pt-BR") ||
          a.matricula.localeCompare(b.matricula, "pt-BR"),
      ),
    }))
    .sort(
      (a, b) =>
        b.colaboradores.length - a.colaboradores.length ||
        a.horarioPrincipal.localeCompare(b.horarioPrincipal, "pt-BR"),
    );
}

