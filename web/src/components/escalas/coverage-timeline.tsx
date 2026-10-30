"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { visibleDates } from "@/lib/escalas/dates";
import { compareSectors } from "@/lib/escalas/order";
import { buildCoveragePresence, coverageTimeline } from "@/lib/escalas/coverage-presence";
import { buildEscalaSchedule, escalaDateLabel, escalaDuration } from "@/lib/escalas/presentation";
import type { EscalaInput } from "@/lib/escalas/types";
import { controlClass, Field, panelClass } from "./controls";
import styles from "./escalas.module.css";
import type { EscalaRecoveryRequest } from "./recovery-navigation";

export function CoverageTimeline({ input, review }: { input: EscalaInput; review?: EscalaRecoveryRequest }) {
  const dates = useMemo(() => visibleDates(input), [input]);
  const sectors = useMemo(() => [...new Set(input.employees.filter(person => person.planningEnabled !== false).map(person => person.sector).filter(Boolean))].sort(compareSectors), [input]);
  const [selectedDate, setSelectedDate] = useState(""), [selectedSector, setSelectedSector] = useState(""), [selectedStart, setSelectedStart] = useState<number | null>(null);
  const reviewedRequest = useRef(0);
  useEffect(() => {
    if (!review || reviewedRequest.current === review.request) return;
    reviewedRequest.current = review.request;
    if (review.date && dates.includes(review.date)) setSelectedDate(review.date);
    if (review.sector && sectors.includes(review.sector)) setSelectedSector(review.sector);
    setSelectedStart(review.start ?? null);
  }, [review, dates, sectors]);
  const date = dates.includes(selectedDate) ? selectedDate : dates[0] ?? input.startDate;
  const sector = sectors.includes(selectedSector) ? selectedSector : sectors[0] ?? "";
  const index = useMemo(() => buildCoveragePresence(input), [input]);
  const timeline = useMemo(() => coverageTimeline(input, date, sector, index), [input, date, sector, index]);
  const schedules = useMemo(() => new Map(buildEscalaSchedule(input).people.map(person => [person.employee.id, person.cells.find(cell => cell.date === date)])), [input, date]);
  const selected = timeline.find(slice => slice.start === selectedStart) ?? timeline[0];
  const start = timeline[0]?.start ?? 0, end = timeline.at(-1)?.end ?? 1440;
  const maximum = Math.max(1, ...timeline.flatMap(slice => [slice.present, slice.minimum, slice.estimate]));
  const x = (minute: number) => 36 + (minute - start) / Math.max(1, end - start) * 708;
  const y = (count: number) => 148 - count / maximum * 120;
  const line = (field: "minimum" | "estimate") => timeline.map((slice, position) => (position ? "L" : "M") + x(slice.start) + " " + y(slice[field]) + " L" + x(slice.end) + " " + y(slice[field])).join(" ");
  return <section id="escala-coverage-timeline" tabIndex={-1} className={panelClass} aria-labelledby="escala-presence-title">
    <div><h2 id="escala-presence-title" className={styles.sectionTitle}>Colaboradores por horário</h2>
      <p className={styles.muted}>Presença efetiva na proposta. Intervalos, folgas, afastamentos e pessoas sem horário fixo não entram na contagem por hora.</p></div>
    {input.needsRegeneration && <p role="status" className={styles.muted}>Grade anterior: gere e aplique a nova proposta para atualizar esta visão.</p>}
    <div className={styles.formGrid}>
      <Field label="Data da cobertura">{id => <select id={id} className={controlClass} value={date} onChange={event => { setSelectedDate(event.target.value); setSelectedStart(null); }}>{dates.map(day => <option key={day} value={day}>{escalaDateLabel(day)}</option>)}</select>}</Field>
      <Field label="Setor no gráfico">{id => <select id={id} className={controlClass} value={sector} onChange={event => { setSelectedSector(event.target.value); setSelectedStart(null); }}>{sectors.map(item => <option key={item}>{item}</option>)}</select>}</Field>
    </div>
    {!timeline.length ? <p className={styles.muted}>Nenhum horário processado ou referência de cobertura nesta data e setor. Gere a proposta ou confira os horários da equipe.</p> : <>
      <figure className={styles.timelineFrame}>
        <div className={styles.timelineAxis}><span>Pessoas: 0–{maximum}</span></div>
        <svg viewBox="0 0 780 160" preserveAspectRatio="none" role="img" aria-labelledby="escala-coverage-chart-title escala-coverage-chart-desc" className={styles.timelinePlot}>
          <title id="escala-coverage-chart-title">Presença por horário em {sector}, {escalaDateLabel(date)}</title>
          <desc id="escala-coverage-chart-desc">Contagem de pessoas trabalhando em cada faixa exata. Consulte a faixa abaixo para ler valores e nomes. As barras não incluem intervalos.</desc>
          <line x1="36" x2="744" y1="148" y2="148" stroke="currentColor" />
          {timeline.map(slice => <rect key={slice.start} x={x(slice.start)} y={y(slice.present)} width={Math.max(0, x(slice.end) - x(slice.start))} height={148 - y(slice.present)} className={styles.timelineBar}><title>{escalaDuration(slice.start)}–{escalaDuration(slice.end)}: {slice.present} pessoa(s), mínimo {slice.minimum}, estimativa {slice.estimate}</title></rect>)}
          {timeline.some(slice => slice.minimum > 0) && <path d={line("minimum")} className={styles.timelineMinimum} />}
          {timeline.some(slice => slice.estimate > 0) && <path d={line("estimate")} className={styles.timelineEstimate} />}
        </svg>
        <div className={styles.timelineAxis}><span>{escalaDuration(start)}</span><span>{escalaDuration(end)}</span></div>
        <figcaption className={styles.timelineLegend}><span>Barras: pessoas trabalhando</span><span>Linha contínua: mínimo informado</span><span>Linha tracejada: estimativa automática, não garantia</span></figcaption>
      </figure>
      <Field label="Faixa de horário e colaboradores">{id => <select id={id} className={controlClass} value={selected?.start ?? ""} onChange={event => setSelectedStart(Number(event.target.value))}>{timeline.map(slice => <option key={slice.start} value={slice.start}>{escalaDuration(slice.start)}–{escalaDuration(slice.end)} · {slice.present} trabalhando{slice.minimum ? " · mínimo " + slice.minimum : ""}{slice.estimate ? " · estimativa " + slice.estimate : ""}{slice.present === 0 ? " · sem presença" : ""}</option>)}</select>}</Field>
      {selected && <div aria-live="polite" aria-atomic="true" className={styles.stackSmall}>
        <h3 className={styles.sectionTitle}>{escalaDuration(selected.start)}–{escalaDuration(selected.end)}: {selected.present} trabalhando</h3>
        {!selected.people.length ? <p className={styles.muted}>Nenhum colaborador com trabalho efetivo nesta faixa.</p> : <ul className={styles.stackSmall}>{selected.people.map(person => <li key={person.id}><strong>{person.registration} — {person.name}</strong> — {person.role}<span className="block">Horário proposto: {schedules.get(person.id)?.schedule}. Intervalo: {schedules.get(person.id)?.interval}.</span>{/gerent|encarregad|supervisor|lider|líder/i.test(person.role) ? " · liderança identificada, sem substituição automática de outras funções" : ""}</li>)}</ul>}
      </div>}
      <details className={styles.disclosure}><summary className={styles.disclosureTrigger}>Consultar todas as faixas e transições</summary>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Presença exata por faixa de horário</caption><thead><tr><th scope="col">Horário</th><th scope="col">Trabalhando</th><th scope="col">Mínimo informado</th><th scope="col">Estimativa</th><th scope="col">Entradas ou retornos</th><th scope="col">Saídas ou início de intervalo</th></tr></thead><tbody>{timeline.map((slice, position) => { const before = timeline[position - 1]?.people ?? []; const arrivals = slice.people.filter(person => !before.some(previous => previous.id === person.id)); const departures = before.filter(person => !slice.people.some(current => current.id === person.id)); return <tr key={slice.start}><th scope="row">{escalaDuration(slice.start)}–{escalaDuration(slice.end)}</th><td>{slice.present}</td><td>{slice.minimum || "Não informado"}</td><td>{slice.estimate || "Sem referência"}</td><td>{arrivals.map(person => person.registration + " · " + person.name).join(", ") || "—"}</td><td>{departures.map(person => person.registration + " · " + person.name).join(", ") || "—"}</td></tr>; })}</tbody></table></div>
      </details>
    </>}
  </section>;
}
