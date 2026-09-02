type UnimedEmailFeedbackProps = {
  sent: boolean;
  error: string | null;
};

export function UnimedEmailFeedback({
  sent,
  error,
}: UnimedEmailFeedbackProps) {
  if (!sent || error) return null;

  return (
    <p
      className="mt-3 rounded-xl border border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)] px-3 py-2.5 text-center text-sm font-bold text-[color:var(--app-fg)]"
      role="status"
      aria-live="polite"
    >
      E-mail enviado com sucesso. A solicitação de coparticipação foi confirmada
      pelo servidor.
    </p>
  );
}
