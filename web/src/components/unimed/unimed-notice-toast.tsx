"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect } from "react";

export type UnimedNotice = {
  id: string;
  type: "info" | "success" | "error";
  title: string;
  message: string;
};

export function UnimedNoticeToast({
  notice,
  onClose,
}: {
  notice: UnimedNotice | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(
      onClose,
      notice.type === "error" ? 9_000 : notice.type === "info" ? 7_000 : 5_000,
    );
    return () => window.clearTimeout(timeout);
  }, [notice, onClose]);

  if (!notice) return null;
  const Icon =
    notice.type === "error"
      ? AlertCircle
      : notice.type === "success"
        ? CheckCircle2
        : Info;

  return (
    <div
      className={`unimed-notice-toast fixed top-20 right-4 z-[80] flex w-[min(26rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border p-4 shadow-2xl ${notice.type === "error" ? "border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)]" : notice.type === "success" ? "border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)]" : "border-[color:var(--app-gold)] bg-[color:var(--app-warning-soft)]"}`}
      role={notice.type === "error" ? "alert" : "status"}
      aria-live={notice.type === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      data-notice-id={notice.id}
    >
      <Icon
        className={`mt-0.5 size-5 shrink-0 ${notice.type === "error" ? "text-[color:var(--app-coral)]" : notice.type === "success" ? "text-[color:var(--app-lime)]" : "text-[color:var(--app-gold)]"}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-[color:var(--app-fg)]">
          {notice.title}
        </p>
        <p className="mt-1 text-xs leading-5 text-[color:var(--app-muted)]">
          {notice.message}
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-[color:var(--app-muted)] hover:bg-black/10"
        aria-label="Fechar aviso"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
