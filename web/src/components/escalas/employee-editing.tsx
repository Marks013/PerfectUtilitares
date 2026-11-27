"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EscalaEmployee } from "@/lib/escalas/types";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { buttonClass } from "./controls";

type PendingEdit = { employee: EscalaEmployee | null; existing: boolean };

export function useEmployeeEditing(employees: EscalaEmployee[], enabled: boolean) {
  const [editing, setEditing] = useState<EscalaEmployee | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [pending, setPending] = useState<PendingEdit | null>(null);
  const [error, setError] = useState("");
  const reportDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);
  const requestEdit = useCallback((employee: EscalaEmployee | null) => {
    if (employee && !enabled || employee?.id === editing?.id) return;
    if (dirtyRef.current) {
      setError("");
      setPending({ employee, existing: Boolean(employee && employees.some(item => item.id === employee.id)) });
      return;
    }
    setEditing(employee);
  }, [editing?.id, enabled, employees]);
  const finishEditing = useCallback(() => {
    reportDirty(false);
    setEditing(null);
    setPending(null);
    setError("");
  }, [reportDirty]);
  function cancelPending() { setPending(null); setError(""); }
  function confirmPending() {
    if (!pending || !enabled) return;
    const latest = pending.employee && employees.find(item => item.id === pending.employee?.id);
    if (pending.existing && !latest) {
      setError("O colaborador de destino não está mais disponível. Continue editando e confira a equipe.");
      return;
    }
    reportDirty(false);
    setEditing(latest || pending.employee);
    setPending(null);
    setError("");
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return { editing, dirty, pending, error, enabled, requestEdit, reportDirty, finishEditing, cancelPending, confirmPending };
}

export function EmployeeDraftDialog({ editor, fallbackFocus }: {
  editor: ReturnType<typeof useEmployeeEditing>;
  fallbackFocus: () => void;
}) {
  return <AlertDialog open={Boolean(editor.pending)} onOpenChange={open => { if (!open) editor.cancelPending(); }}>
    <AlertDialogContent onCloseAutoFocus={event => {
      event.preventDefault();
      requestAnimationFrame(() => {
        const form = document.getElementById("escala-employee-editor");
        if (form) form.focus(); else fallbackFocus();
      });
    }}>
      <AlertDialogHeader>
        <AlertDialogTitle>Descartar edição não aplicada?</AlertDialogTitle>
        <AlertDialogDescription>
          As alterações de {editor.editing?.name || "este colaborador"} ainda não foram aplicadas à proposta.
          Continue editando para aplicar o cadastro ou descarte somente esta edição para {editor.pending?.employee ? "abrir outro cadastro" : "fechar o editor"}.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {editor.error && <p role="alert" className="app-text-danger">{editor.error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel className={buttonClass}>Continuar editando</AlertDialogCancel>
        <AlertDialogAction disabled={!editor.enabled} className="app-radius-md app-bg-danger px-4 py-2 text-sm font-medium disabled:opacity-60" onClick={event => {
          event.preventDefault();
          editor.confirmPending();
        }}>Descartar edição e continuar</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
