import { buttonClass, primaryClass } from "../controls";
import styles from "../escalas.module.css";
import local from "./flow.module.css";
import { expectedBytes, omissionLabels, personKey } from "./flow-model";
import type { ExportFlow } from "./use-export-flow";
import { supportsTurnoVinculos, type TurnoExportFormat } from "@/lib/escalas/shift-catalog/domain";

const fileLabels: Record<TurnoExportFormat, { prepare: string; download: string }> = {
  CADASTRO: { prepare: "Preparar cadastro em massa de jornadas e turnos", download: "Baixar cadastro de jornadas e turnos" },
  VINCULOS: { prepare: "Preparar alteração de jornadas dos colaboradores", download: "Baixar vínculos por matrícula" },
  TXT1: { prepare: "Preparar arquivo de colaboradores (TXT1)", download: "Baixar TXT1 conferido" },
  TXT2: { prepare: "Preparar definições de turnos (TXT2)", download: "Baixar TXT2 conferido" },
};

export function ExportPreview({ flow, disabled, canDefine }: { flow: ExportFlow; disabled: boolean; canDefine: boolean }) {
  const manifest = flow.manifest;
  if (!manifest) return null;
  const linksBlocked = manifest.mode === "EMPLOYEES" && !supportsTurnoVinculos(manifest.rows);
  const formats: readonly TurnoExportFormat[] = manifest.formats;
  const count = (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`;
  const totals = [count(manifest.counts.selected, "item selecionado", "itens selecionados"), ...(manifest.mode === "EMPLOYEES" ? [count(manifest.counts.includedEmployees, "pessoa incluída", "pessoas incluídas")] : []), count(manifest.counts.includedCodes, "código", "códigos"), count(manifest.counts.omitted, "omissão", "omissões"), count(manifest.counts.blockers, "bloqueio", "bloqueios")];
  return <section className={styles.stackSmall} aria-label="Conferência da seleção">
    <h3 className={styles.sectionTitle}>Confira antes de preparar o arquivo</h3>
    <p>{totals.join(" · ")}.</p>
    <p className={styles.muted}>{flow.period} · {manifest.mode === "CATALOG" ? "Turnos cadastrados" : "Turnos por colaborador"} · TXT1: {count(manifest.counts.txt1Lines, "linha", "linhas")} · TXT2: {count(manifest.counts.txt2Lines, "linha", "linhas")}. Validade até {new Date(manifest.expiresAt).toLocaleTimeString("pt-BR")}. Identificação: {manifest.selectionDigest.slice(0, 12)}.</p>
    <section className={local.preview}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The preview must be keyboard-scrollable.
      tabIndex={0} aria-label="Linhas conferidas para os arquivos"><table><thead><tr>{manifest.mode === "EMPLOYEES" && <th>Matrícula / pessoa</th>}<th>Código</th><th>Marcações conferidas</th></tr></thead><tbody>{manifest.rows.map(row => <tr key={"employeeId" in row ? personKey(row) : String(row.code)}>{manifest.mode === "EMPLOYEES" && "employeeId" in row && <td>{row.registration} · {flow.people.find(person => person.workspaceId === row.workspaceId && person.employeeId === row.employeeId)?.name ?? row.employeeId}</td>}<td>{row.code}</td><td>{row.markings.join(" / ")}</td></tr>)}</tbody></table></section>
    {manifest.omissions.length > 0 && <div><h4>Selecionados que não entrarão no arquivo</h4><ul>{manifest.omissions.map(item => <li key={`${item.workspaceId}:${item.employeeId}:${item.reason}`}>{item.registration || "Sem matrícula"} · {flow.people.find(person => person.workspaceId === item.workspaceId && person.employeeId === item.employeeId)?.name ?? item.employeeId}: {omissionLabels[item.reason]}</li>)}</ul></div>}
    {manifest.blockers.map(blocker => <p key={`${blocker.reason}:${blocker.members.map(personKey).join("|")}`} role="alert" className={styles.errorText}>{blocker.message} {blocker.members.map(key => flow.people.find(person => person.workspaceId === key.workspaceId && person.employeeId === key.employeeId)?.name ?? key.employeeId).join(", ")}</p>)}
    {canDefine && manifest.omissions.some(item => item.reason === "CATALOG_REQUIRED") && <div className={styles.stackSmall}><label className={styles.check}><input className={styles.checkInput} type="checkbox" checked={flow.confirmSync} onChange={event => flow.setConfirmSync(event.target.checked)} />Confirmo o cadastro das referências selecionadas sem código no catálogo da empresa.</label><button type="button" className={buttonClass} disabled={disabled || Boolean(flow.task.busy) || !flow.confirmSync} onClick={() => void flow.syncMissing()}>Cadastrar referências confirmadas</button></div>}
    {manifest.omissions.length > 0 && <label className={styles.check}><input className={styles.checkInput} type="checkbox" checked={flow.acceptOmissions} onChange={event => flow.setAcceptOmissions(event.target.checked)} />Aceito exportar somente as linhas incluídas, com as omissões listadas.</label>}
    {linksBlocked && <p className={styles.errorText}>Corrija as matrículas com ponto e vírgula para preparar o arquivo de vínculos.</p>}
    <div className={styles.actions}>{(["CADASTRO", "VINCULOS", "TXT1", "TXT2"] as const).filter(format => formats.includes(format)).map(format => {
      const label = fileLabels[format];
      return <div key={format}><button type="button" className={format.startsWith("TXT") ? buttonClass : primaryClass} disabled={disabled || Boolean(flow.task.busy) || manifest.blockers.length > 0 || !expectedBytes(manifest, format).length || Boolean(manifest.omissions.length && !flow.acceptOmissions)} onClick={() => void flow.prepareFile(format)}>{label.prepare}</button>{flow.files[format] && <a className={buttonClass} href={flow.files[format]} download={`turnos-${flow.period}-${format}.txt`}>{label.download}</a>}</div>;
    })}</div>
  </section>;
}
