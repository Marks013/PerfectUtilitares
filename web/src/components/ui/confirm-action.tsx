"use client";

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "./alert-dialog";

type Confirmation = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  onConfirm: () => Promise<unknown>;
};

type ConfirmActionProps = Omit<Confirmation, "pendingLabel"> & {
  children: ReactElement;
  pendingLabel?: string;
};

/** One confirmation contract for destructive mutations; the server still authorizes them. */
export function ConfirmAction({ children, title, description, confirmLabel, pendingLabel = "Excluindo…", onConfirm }: ConfirmActionProps) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const triggerRegion = useRef<HTMLSpanElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function changeOpen(open: boolean) {
    if (running.current) return;
    setError("");
    // Freeze the displayed scope and its callback together, even if a query refreshes.
    setConfirmation(open ? { title, description, confirmLabel, pendingLabel, onConfirm } : null);
  }

  async function confirm() {
    if (!confirmation || running.current) return;
    running.current = true;
    setPending(true);
    setError("");
    try {
      await confirmation.onConfirm();
      setConfirmation(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir. Confira sua conexão e tente novamente.");
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <AlertDialog open={confirmation !== null} onOpenChange={changeOpen}>
      <span ref={triggerRegion} tabIndex={-1} className="inline-flex max-w-full">
        <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      </span>
      <AlertDialogContent
        onEscapeKeyDown={(event) => { if (running.current) event.preventDefault(); }}
        onCloseAutoFocus={(event) => {
          // A successful deletion can disable the original trigger (empty list).
          if (triggerRegion.current?.querySelector("button:disabled")) {
            event.preventDefault();
            triggerRegion.current.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation?.title ?? title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmation?.description ?? description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mt-4 app-radius-md border app-border-danger app-bg-danger-soft p-3 text-sm app-text-danger">{error}</p>}
        <p role="status" aria-live="polite" className="mt-3 min-h-6 text-sm app-text-muted">
          {pending ? "Aguarde a confirmação. A ação está em andamento." : ""}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11 app-radius-md border app-border px-4 py-2 text-sm font-medium app-text app-hover-surface disabled:opacity-60">
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            aria-busy={pending}
            aria-label={pending ? confirmation?.pendingLabel : confirmation?.confirmLabel}
            onClick={(event) => { event.preventDefault(); void confirm(); }}
            className="grid min-h-11 items-center app-radius-md app-bg-danger px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            <span aria-hidden="true" className={`col-start-1 row-start-1 ${pending ? "invisible" : ""}`}>{confirmation?.confirmLabel ?? confirmLabel}</span>
            <span aria-hidden="true" className={`col-start-1 row-start-1 ${pending ? "" : "invisible"}`}>{confirmation?.pendingLabel ?? pendingLabel}</span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
