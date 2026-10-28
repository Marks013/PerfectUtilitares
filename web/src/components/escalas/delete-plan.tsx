"use client";

import { useRef } from "react";
import { visibleDates } from "@/lib/escalas/dates";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { buttonClass } from "./controls";
import { displayDate } from "./workspace-model";

export function DeletePlan({ workspace, dirty, busy, onDelete }: {
  workspace: EscalaWorkspace; dirty: boolean; busy: boolean; onDelete: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  if (!workspace.canEdit) return null;
  const dates = visibleDates(workspace.input);
  return <>
    <button type="button" className={`${buttonClass} text-[color:var(--app-coral)]`} disabled={busy} onClick={() => dialog.current?.showModal()}>Excluir planejamento</button>
    <dialog ref={dialog} aria-labelledby="escala-delete-title" aria-describedby="escala-delete-description"
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg app-radius-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-6 text-[color:var(--app-fg)] backdrop:bg-black/50">
      <h2 id="escala-delete-title" className="text-lg font-bold">Excluir este planejamento?</h2>
      <div id="escala-delete-description" className="my-4 space-y-3 text-sm">
        <p>Filial {workspace.input.branchCode} · {workspace.input.branchName}<br />{displayDate(dates[0])} a {displayDate(dates.at(-1) ?? dates[0])} · revisão {workspace.revision}</p>
        <p>A exclusão remove o planejamento selecionado e suas revisões. Não pode ser desfeita. Planejamentos com dependências publicadas serão preservados.</p>
        {dirty && <p>As alterações locais ainda não salvas também serão descartadas.</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={buttonClass} onClick={() => dialog.current?.close()}>Manter planejamento</button>
        <button type="button" className={`${buttonClass} border-[color:var(--app-coral)] text-[color:var(--app-coral)]`} onClick={() => { dialog.current?.close(); onDelete(); }}>Confirmar exclusão</button>
      </div>
    </dialog>
  </>;
}
