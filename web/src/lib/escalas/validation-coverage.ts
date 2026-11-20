import { dateRange, visibleDates } from "./dates";
import { buildCoveragePresence, coverageAt, coverageTimeline } from "./coverage-presence";
import type { EscalaInput, EscalaIssue } from "./types";

/** Coverage and staffing references are independent of journey validation. */
export function validateCoverage(input: EscalaInput, presence = buildCoveragePresence(input)): { issues: EscalaIssue[]; minimumCoverageMargin: number | null } {
  const issues: EscalaIssue[] = [];
  let minimumCoverageMargin: number | null = null;
  const visible = new Set(visibleDates(input));
  const timelines = new Map<string, ReturnType<typeof coverageTimeline>>();
  const emptyReported = new Set<string>();
  for (const demand of input.demands) {
    const key = demand.date + "\0" + demand.sector;
    let timeline = timelines.get(key);
    if (!timeline) { timeline = coverageTimeline(input, demand.date, demand.sector, presence); timelines.set(key, timeline); }
    let reported = false;
    for (const slice of timeline) {
      if (slice.start < demand.start || slice.end > demand.end) continue;
      const present = coverageAt(presence, demand.date, demand.sector, slice.start, demand.role).length;
      const margin = present - demand.minimum;
      if (visible.has(demand.date)) minimumCoverageMargin = minimumCoverageMargin === null ? margin : Math.min(minimumCoverageMargin, margin);
      // An estimated shortage is not a confirmed staffing minimum. Nonetheless,
      // a wholly uncovered timed role/sector is a separate operational warning.
      const emptyKey = JSON.stringify([demand.date, demand.sector, demand.role ?? ""]);
      if (demand.estimated === true && demand.minimum > 0 && present === 0
        && visible.has(demand.date) && !input.policy.closedDates.includes(demand.date)
        && !emptyReported.has(emptyKey)) {
        emptyReported.add(emptyKey);
        issues.push({ code: "ESTIMATED_SECTOR_EMPTY", severity: "WARNING", date: demand.date,
          message: "Atenção: " + demand.sector + (demand.role ? " / " + demand.role : "")
            + " sem presença horária conhecida em " + demand.date + ", a partir de "
            + String(Math.floor(slice.start / 60)).padStart(2, "0") + ":"
            + String(slice.start % 60).padStart(2, "0")
            + ". A referência é estimada e não é mínimo homologado; confira a operação antes de publicar." });
      }
      if (margin < 0 && !reported) {
        const estimated = demand.estimated === true;
        issues.push({ code: estimated ? "ESTIMATED_COVERAGE_GAP" : "COVERAGE_DEFICIT", severity: estimated ? "WARNING" : "ERROR", date: demand.date,
          message: demand.sector + (demand.role ? " / " + demand.role : "") + ": " + present + " presente(s), " + (estimated ? "estimativa" : "mínimo") + " " + demand.minimum + ", a partir de " + String(Math.floor(slice.start / 60)).padStart(2, "0") + ":" + String(slice.start % 60).padStart(2, "0") + "." + (estimated ? " Compare a referência com a necessidade real; isso não comprova demanda operacional." : "") });
        reported = true;
      }
    }
  }
  const demandedDates = new Set(input.demands.map((demand) => `${demand.sector}\0${demand.date}`));
  for (const sector of new Set(input.employees.filter((person) => person.planningEnabled !== false && (person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING")).map((person) => person.sector).filter(Boolean))) {
    const members = input.employees.filter((person) => person.planningEnabled !== false && (person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING") && person.sector === sector);
    const missing = dateRange(input.startDate, input.endDate).filter((day) => !input.policy.closedDates.includes(day)
      && members.some((person) => day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil))
      && !demandedDates.has(`${sector}\0${day}`));
    if (missing.length) issues.push({ code: "COVERAGE_PENDING", severity: "PENDING", date: missing[0], message: `Setor ${sector}: ${missing.length} data(s) sem referência de cobertura, a partir de ${missing[0]}. A presença pode ser consultada por horário; não é possível concluir se atende à necessidade operacional nessas datas.` });
  }
  return { issues, minimumCoverageMargin };
}
