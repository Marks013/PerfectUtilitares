export default function UnimedLoading() {
  return (
    <div
      className="grid min-h-[28rem] place-items-center"
      role="status"
      aria-label="Carregando módulo Unimed"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] px-5 py-4 text-sm font-semibold text-[color:var(--app-muted)] shadow-[var(--app-shadow)]">
        <span className="size-5 animate-spin rounded-full border-2 border-[color:var(--app-border-strong)] border-t-[color:var(--app-teal)]" />
        Carregando módulo Unimed…
      </div>
    </div>
  );
}
