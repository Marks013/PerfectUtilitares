import { Bell, Palette, Save } from "lucide-react";
import type {
  PresenceEventDetail,
  PresenceTheme,
} from "./presence-admin-model";
import { localDateInput } from "./presence-admin-model";

const field =
  "mt-1 min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 text-sm text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-action-blue)]";
const primary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-4 text-sm font-bold text-[color:var(--app-action-text)] hover:bg-[color:var(--app-action-blue-hover)] disabled:opacity-50";

const presetOptions: Array<{ value: PresenceTheme["preset"]; label: string }> = [
  { value: "CELEBRATION", label: "Celebração" },
  { value: "ELEGANT", label: "Elegante" },
  { value: "GARDEN", label: "Jardim" },
  { value: "NIGHT", label: "Noite" },
];
const accentOptions: Array<{
  value: PresenceTheme["accent"];
  label: string;
  color: string;
}> = [
  { value: "CORAL", label: "Coral", color: "#e9684a" },
  { value: "BLUE", label: "Azul", color: "#1769aa" },
  { value: "GREEN", label: "Verde", color: "#23815a" },
  { value: "GOLD", label: "Dourado", color: "#9a6b16" },
];

function optionalDate(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  return text ? new Date(text).toISOString() : null;
}

export function PresenceThemeSettings({
  detail,
  busy,
  onSave,
}: {
  detail: PresenceEventDetail;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <details className="mt-4 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
      <summary className="cursor-pointer font-bold">Aparência e automações</summary>
      <form
        className="mt-4 grid gap-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void onSave({
            theme: {
              preset: data.get("preset"),
              cover: data.get("cover"),
              accent: data.get("accent"),
              welcomeTitle: String(data.get("welcomeTitle") ?? "").trim() || null,
            },
            reminderAt: optionalDate(data.get("reminderAt")),
            retentionUntil: optionalDate(data.get("retentionUntil")),
          });
        }}
      >
        <div className="md:col-span-2 flex items-center gap-2 text-sm font-bold">
          <Palette className="size-4 text-[color:var(--app-action-blue)]" aria-hidden="true" /> Visual do convite
        </div>
        <label className="text-sm font-semibold">
          Estilo
          <select name="preset" defaultValue={detail.theme.preset} className={field}>
            {presetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Capa
          <select name="cover" defaultValue={detail.theme.cover} className={field}>
            <option value="EVENT_TABLE">Mesa de celebração</option>
            <option value="NONE">Sem fotografia</option>
          </select>
        </label>
        <fieldset className="md:col-span-2">
          <legend className="text-sm font-semibold">Cor de destaque</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {accentOptions.map((option) => (
              <label key={option.value} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] px-3 text-sm">
                <input type="radio" name="accent" value={option.value} defaultChecked={detail.theme.accent === option.value} />
                <span className="size-4 rounded-full border border-black/15" style={{ backgroundColor: option.color }} aria-hidden="true" />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="text-sm font-semibold md:col-span-2">
          Saudação
          <input name="welcomeTitle" maxLength={80} defaultValue={detail.theme.welcomeTitle ?? ""} className={field} placeholder="Você é nosso convidado" />
        </label>

        <div className="md:col-span-2 mt-2 flex items-center gap-2 border-t border-[color:var(--app-border)] pt-4 text-sm font-bold">
          <Bell className="size-4 text-[color:var(--app-action-green)]" aria-hidden="true" /> Lembrete e retenção
        </div>
        <label className="text-sm font-semibold">
          Enviar lembrete em
          <input name="reminderAt" type="datetime-local" defaultValue={detail.reminderAt ? localDateInput(new Date(detail.reminderAt)) : ""} className={field} />
        </label>
        <label className="text-sm font-semibold">
          Manter dados até
          <input name="retentionUntil" type="datetime-local" defaultValue={detail.retentionUntil ? localDateInput(new Date(detail.retentionUntil)) : ""} className={field} />
        </label>
        <p className="md:col-span-2 text-xs text-[color:var(--app-muted)]">
          O lembrete vai somente para respostas pendentes. A remoção automática ocorre apenas depois que o evento estiver arquivado.
        </p>
        <button type="submit" className={`${primary} md:col-span-2 md:justify-self-start`} disabled={busy}>
          <Save className="size-4" aria-hidden="true" /> Salvar aparência e automações
        </button>
      </form>
    </details>
  );
}
