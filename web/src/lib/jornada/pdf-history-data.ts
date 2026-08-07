type JornadaPdfRecord = {
  id: string;
  createdAt: Date;
  horariosOriginal: string;
  horariosNormalizado: string;
  valido: boolean;
  mensagem: string;
  duracaoCalculada: string | null;
  tipoDia: string;
  codigo: string | null;
  horasSemanais: number | null;
  horasMensais: number | null;
  intervalo: string | null;
  user?: { name: string | null; email: string | null } | null;
};

export type JornadaPdfEntry = {
  nome: string;
  matricula: string;
  dataAlteracao: string;
  records: JornadaPdfRecord[];
};

type JornadaPdfPerson = {
  nome: string;
  matricula: string;
};

export type JornadaPdfGroup = {
  dataAlteracao: string;
  records: JornadaPdfRecord[];
  people: JornadaPdfPerson[];
};

export type JornadaPdfDebugGroup = {
  dataAlteracao: string;
  horarios: string;
  codigo: string;
  peopleCount: number;
};

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatDateOnly(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(date);
}

export function formatInputDate(value: string) {
  if (!value) {
    return "____/____/________";
  }

  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

function sortRecords(records: JornadaPdfRecord[]) {
  return [...records].sort((a, b) => {
    const order = (value: string) => (value === "sabado" ? 2 : 1);
    return order(a.tipoDia) - order(b.tipoDia);
  });
}

function joinUnique(values: Array<string | null | undefined>, fallback = "-") {
  const unique = [...new Set(values.filter(Boolean) as string[])];
  return unique.length ? unique.join(" + ") : fallback;
}

function getEntryHorarios(entry: JornadaPdfEntry) {
  const records = sortRecords(entry.records);
  return records
    .map((record) =>
      record.tipoDia === "sabado"
        ? `Sábado: ${record.horariosNormalizado}`
        : record.horariosNormalizado,
    )
    .join(" + ");
}

function getEntryCodigo(entry: JornadaPdfEntry) {
  return getRecordsCodigo(entry.records);
}

function getRecordsCodigo(records: JornadaPdfRecord[]) {
  const sorted = sortRecords(records);

  if (sorted.length <= 1) {
    return joinUnique(sorted.map((record) => record.codigo));
  }

  return sorted
    .map((record) => {
      const label = record.tipoDia === "sabado" ? "Sábado" : "Segunda a sexta";
      return `${label}: ${record.codigo ?? "-"}`;
    })
    .join(" | ");
}

function getEntryPeriodo(entry: JornadaPdfEntry) {
  const dates = entry.records
    .map((record) => record.createdAt)
    .sort((a, b) => a.getTime() - b.getTime());

  if (!dates.length) {
    return "-";
  }

  const first = formatDateOnly(dates[0]);
  const last = formatDateOnly(dates[dates.length - 1]);
  return first === last ? first : `${first} a ${last}`;
}

export function groupEntries(entries: JornadaPdfEntry[]): JornadaPdfGroup[] {
  const groups = new Map<string, JornadaPdfGroup>();

  entries.forEach((entry) => {
    const records = sortRecords(entry.records);
    const key = [
      getEntryHorarios(entry),
      getEntryCodigo(entry),
      entry.dataAlteracao,
    ].join("::");
    const group =
      groups.get(key) ??
      {
        dataAlteracao: entry.dataAlteracao,
        records,
        people: [],
      };

    group.people.push({
      nome: entry.nome,
      matricula: entry.matricula,
    });
    groups.set(key, group);
  });

  return [...groups.values()].sort((a, b) => {
    const horarioCompare = getGroupHorarios(a).localeCompare(
      getGroupHorarios(b),
      "pt-BR",
    );
    if (horarioCompare !== 0) {
      return horarioCompare;
    }

    return a.dataAlteracao.localeCompare(b.dataAlteracao);
  });
}

export function getJornadaPdfDebugGroups(
  entries: JornadaPdfEntry[],
): JornadaPdfDebugGroup[] {
  return groupEntries(entries).map((group) => ({
    dataAlteracao: group.dataAlteracao,
    horarios: getGroupHorarios(group),
    codigo: getGroupCodigo(group),
    peopleCount: group.people.length,
  }));
}

export function getGroupHorarios(group: JornadaPdfGroup) {
  return getEntryHorarios({
    nome: "",
    matricula: "",
    dataAlteracao: group.dataAlteracao,
    records: group.records,
  });
}

export function getGroupCodigo(group: JornadaPdfGroup) {
  return getRecordsCodigo(group.records);
}

export function getGroupDuracao(group: JornadaPdfGroup) {
  return joinUnique(group.records.map((record) => record.duracaoCalculada));
}

export function getGroupPeriodo(group: JornadaPdfGroup) {
  return getEntryPeriodo({
    nome: "",
    matricula: "",
    dataAlteracao: group.dataAlteracao,
    records: group.records,
  });
}

export function getGroupHeight(group: JornadaPdfGroup) {
  return 78 + Math.max(1, group.people.length) * 15;
}

