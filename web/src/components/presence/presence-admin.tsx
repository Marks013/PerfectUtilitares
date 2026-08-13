"use client";

import {
  Archive,
  CalendarDays,
  Check,
  Clipboard,
  Link2,
  LoaderCircle,
  Mail,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
  UserRoundPlus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  type PresenceEventDetail,
  type PresenceEventSummary,
  type PresenceStatus,
  deliveryLabel,
  localDateInput,
  presenceApi,
  rsvpLabel,
  slugifyPresence,
  statusLabel,
} from "./presence-admin-model";
import { PresenceAdminOverview } from "./presence-admin-overview";
import { PresenceGiftManager } from "./presence-gift-manager";
import { PresenceThemeSettings } from "./presence-theme-settings";

const panel = "rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] shadow-[var(--app-panel-shadow)]";
const field = "mt-1 min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 text-sm text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-action-blue)]";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-4 text-sm font-bold text-[color:var(--app-action-text)] hover:bg-[color:var(--app-action-blue-hover)] disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 text-sm font-semibold text-[color:var(--app-fg)] hover:border-[color:var(--app-action-blue)] disabled:opacity-50";
const danger = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-danger)] px-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50";

function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="mt-3 rounded-xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] px-3 py-2 text-sm text-[color:var(--app-danger)]">
      {message}
    </p>
  ) : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function isRetryableDelivery(status: string | undefined) {
  return ["FAILED", "BOUNCED", "COMPLAINED", "SUPPRESSED"].includes(
    status ?? "",
  );
}

export function PresenceAdmin() {
  const [events, setEvents] = useState<PresenceEventSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PresenceEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [latestLink, setLatestLink] = useState<string | null>(null);
  const [guestSearch, setGuestSearch] = useState("");
  const [guestFilter, setGuestFilter] = useState<
    "ALL" | "PENDING" | "CONFIRMED" | "DECLINED"
  >("ALL");

  const loadEvents = useCallback(async () => {
    const data = await presenceApi<PresenceEventSummary[]>("/api/admin/presencas");
    setEvents(data);
    setSelectedId((current) => current ?? data[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async (eventId: string) => {
    const data = await presenceApi<PresenceEventDetail>(`/api/admin/presencas/${eventId}`);
    setDetail(data);
  }, []);

  useEffect(() => {
    loadEvents().catch((cause: Error) => setError(cause.message)).finally(() => setLoading(false));
  }, [loadEvents]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    loadDetail(selectedId).catch((cause: Error) => setError(cause.message)).finally(() => setLoading(false));
  }, [loadDetail, selectedId]);

  async function refresh() {
    setError(null);
    await Promise.all([loadEvents(), selectedId ? loadDetail(selectedId) : Promise.resolve()]);
  }

  async function sendInvitations(guestIds: string[]) {
    if (!detail || !guestIds.length) return;
    setBusy("delivery-send");
    setError(null);
    setNotice(null);
    try {
      const result = await presenceApi<{
        results: Array<{ status: "SENT" | "FAILED" | "SKIPPED" | "SENDING" }>;
      }>(`/api/admin/presencas/${detail.id}/entregas`, {
        method: "POST",
        body: JSON.stringify({ requestId: crypto.randomUUID(), guestIds }),
      });
      const sent = result.results.filter((item) => item.status === "SENT").length;
      const failed = result.results.filter((item) => item.status === "FAILED").length;
      const skipped = result.results.filter((item) => item.status === "SKIPPED").length;
      setNotice(
        `${sent} convite${sent === 1 ? " enviado" : "s enviados"}.${failed ? ` ${failed} falharam.` : ""}${skipped ? ` ${skipped} sem e-mail foram ignorados.` : ""}`,
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível enviar os convites.");
    } finally {
      setBusy(null);
    }
  }

  async function retryDelivery(deliveryId: string) {
    if (!detail) return;
    setBusy(`delivery-${deliveryId}`);
    setError(null);
    setNotice(null);
    try {
      await presenceApi(`/api/admin/presencas/${detail.id}/entregas/${deliveryId}/reenviar`, { method: "POST" });
      setNotice("Convite reenviado.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível reenviar o convite.");
    } finally {
      setBusy(null);
    }
  }

  async function createEvent(form: HTMLFormElement) {
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const startsAt = new Date(String(data.get("startsAt")));
    const deadline = new Date(String(data.get("deadline")));
    setBusy("event-create");
    setError(null);
    try {
      const created = await presenceApi<{ id: string }>("/api/admin/presencas", {
        method: "POST",
        body: JSON.stringify({
          title,
          eventSlug: slugifyPresence(String(data.get("eventSlug") || title)),
          startsAt: startsAt.toISOString(),
          confirmationDeadline: deadline.toISOString(),
          venueName: String(data.get("venueName") ?? ""),
          venueAddress: String(data.get("venueAddress") ?? ""),
          status: "DRAFT",
        }),
      });
      form.reset();
      await loadEvents();
      setSelectedId(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o evento.");
    } finally {
      setBusy(null);
    }
  }

  async function updateEvent(payload: Record<string, unknown>) {
    if (!detail) return;
    setBusy("event-update");
    setError(null);
    try {
      await presenceApi(`/api/admin/presencas/${detail.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o evento.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEventForm(form: HTMLFormElement) {
    const data = new FormData(form);
    await updateEvent({
      title: String(data.get("title") ?? ""),
      eventSlug: slugifyPresence(String(data.get("eventSlug") ?? "")),
      startsAt: new Date(String(data.get("startsAt"))).toISOString(),
      confirmationDeadline: new Date(String(data.get("deadline"))).toISOString(),
      venueName: String(data.get("venueName") ?? ""),
      venueAddress: String(data.get("venueAddress") ?? ""),
      description: String(data.get("description") ?? ""),
    });
  }

  async function deleteEvent() {
    if (!detail) return;
    setBusy("event-delete");
    try {
      await presenceApi(`/api/admin/presencas/${detail.id}`, { method: "DELETE" });
      setSelectedId(null);
      setDetail(null);
      await loadEvents();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir o evento.");
    } finally {
      setBusy(null);
    }
  }

  async function createGuest(form: HTMLFormElement) {
    if (!detail) return;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    setBusy("guest-create");
    setLatestLink(null);
    try {
      const result = await presenceApi<{ shortUrl: string }>(`/api/admin/presencas/${detail.id}/convidados`, {
        method: "POST",
        body: JSON.stringify({
          name,
          email: String(data.get("email") ?? ""),
          guestSlug: slugifyPresence(String(data.get("guestSlug") || name)),
          companionLimit: Number(data.get("companionLimit") ?? 0),
        }),
      });
      form.reset();
      setLatestLink(result.shortUrl);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(null);
    }
  }

  async function guestAction(guestId: string, action: "confirm" | "decline" | "reset" | "link" | "delete") {
    if (!detail) return;
    setBusy(`guest-${guestId}`);
    setLatestLink(null);
    try {
      if (action === "link") {
        const result = await presenceApi<{ shortUrl: string }>(`/api/admin/presencas/${detail.id}/convidados/${guestId}/renovar-link`, { method: "POST" });
        setLatestLink(result.shortUrl);
      } else if (action === "delete") {
        await presenceApi(`/api/admin/presencas/${detail.id}/convidados/${guestId}`, { method: "DELETE" });
      } else {
        const status = action === "confirm" ? "CONFIRMED" : action === "decline" ? "DECLINED" : "PENDING";
        await presenceApi(`/api/admin/presencas/${detail.id}/convidados/${guestId}`, { method: "PATCH", body: JSON.stringify({ rsvpStatus: status, companionCount: 0 }) });
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o convite.");
    } finally {
      setBusy(null);
    }
  }

  async function saveGuest(guestId: string, form: HTMLFormElement) {
    if (!detail) return;
    const data = new FormData(form);
    setBusy(`guest-${guestId}`);
    try {
      await presenceApi(`/api/admin/presencas/${detail.id}/convidados/${guestId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? "") || null,
          guestSlug: slugifyPresence(String(data.get("guestSlug") ?? "")),
          companionLimit: Number(data.get("companionLimit") ?? 0),
        }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o convite.");
    } finally {
      setBusy(null);
    }
  }

  const filteredGuests = useMemo(() => {
    const guests = detail?.guests ?? [];
    const term = guestSearch.trim().toLocaleLowerCase("pt-BR");
    return guests.filter((guest) => {
      if (guestFilter !== "ALL" && guest.rsvpStatus !== guestFilter) return false;
      if (!term) return true;
      return `${guest.name} ${guest.email ?? ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(term);
    });
  }, [detail, guestFilter, guestSearch]);

  return (
    <div className="space-y-5 text-[color:var(--app-fg)]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[color:var(--app-action-green)]">Acesso reservado</p>
          <h1 className="mt-1 text-balance text-2xl font-black sm:text-3xl">Gestão de eventos</h1>
          <p className="mt-1 max-w-2xl text-pretty text-sm text-[color:var(--app-muted)]">Crie convites individuais, acompanhe confirmações e organize a lista de presentes.</p>
        </div>
        <button type="button" onClick={() => void refresh()} className={secondary} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Atualizar
        </button>
      </header>

      <ErrorNote message={error} />
      {notice ? <p role="status" className="rounded-xl border border-[color:var(--app-action-green)] bg-[color:var(--app-surface)] px-3 py-2 text-sm text-[color:var(--app-fg)]">{notice}</p> : null}

      <section className={`${panel} p-4 sm:p-5`}>
        <div className="mb-4 flex items-center gap-2"><CalendarDays className="size-5 text-[color:var(--app-action-blue)]" /><h2 className="text-lg font-bold">Novo evento</h2></div>
        <form onSubmit={(event) => { event.preventDefault(); void createEvent(event.currentTarget); }} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-semibold">Nome<input name="title" required minLength={2} maxLength={120} className={field} placeholder="Aniversário da Marina" /></label>
          <label className="text-sm font-semibold">Endereço curto<input name="eventSlug" maxLength={80} className={field} placeholder="aniversario-marina" /></label>
          <label className="text-sm font-semibold">Data do evento<input name="startsAt" type="datetime-local" required defaultValue={localDateInput(new Date(Date.now() + 30 * 86_400_000))} className={field} /></label>
          <label className="text-sm font-semibold">Confirmar até<input name="deadline" type="datetime-local" required defaultValue={localDateInput(new Date(Date.now() + 23 * 86_400_000))} className={field} /></label>
          <label className="text-sm font-semibold">Local<input name="venueName" maxLength={160} className={field} placeholder="Salão principal" /></label>
          <label className="text-sm font-semibold md:col-span-2">Endereço<input name="venueAddress" maxLength={300} className={field} placeholder="Rua, número e cidade" /></label>
          <button type="submit" className={`${primary} self-end`} disabled={busy === "event-create"}>{busy === "event-create" ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} Criar evento</button>
        </form>
      </section>

      <div className="grid gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className={`${panel} max-h-[44rem] overflow-y-auto p-3`}>
          <div className="mb-3 flex items-center justify-between px-1"><h2 className="font-bold">Eventos</h2><span className="text-sm tabular-nums text-[color:var(--app-muted)]">{events.length}</span></div>
          <div className="space-y-2">
            {events.map((item) => (
              <button key={item.id} type="button" onClick={() => { setError(null); setSelectedId(item.id); }} className={`w-full rounded-xl border p-3 text-left ${item.id === selectedId ? "border-[color:var(--app-action-blue)] bg-[color:var(--app-card-raised)]" : "border-[color:var(--app-border)] bg-[color:var(--app-surface)]"}`}>
                <span className="block truncate font-bold">{item.title}</span>
                <span className="mt-1 block text-xs text-[color:var(--app-muted)]">{formatDate(item.startsAt)}</span>
                <span className="mt-2 flex items-center justify-between text-xs"><span>{statusLabel[item.status]}</span><span className="tabular-nums">{item._count.guests} pessoas</span></span>
              </button>
            ))}
            {!events.length && !loading ? <p className="px-2 py-8 text-center text-sm text-[color:var(--app-muted)]">Nenhum evento criado.</p> : null}
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          {loading && !detail ? <div className={`${panel} grid min-h-72 place-items-center`}><LoaderCircle className="size-7 animate-spin text-[color:var(--app-action-blue)]" /></div> : null}
          {detail ? (
            <>
              <section className={`${panel} p-4 sm:p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0"><h2 className="truncate text-xl font-black">{detail.title}</h2><p className="mt-1 text-sm text-[color:var(--app-muted)]">/{detail.eventSlug}</p></div>
                  <select aria-label="Situação do evento" value={detail.status} onChange={(event) => void updateEvent({ status: event.target.value as PresenceStatus })} className={`${field} mt-0 w-auto`} disabled={busy === "event-update"}>
                    {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <PresenceAdminOverview detail={detail} />
                <div className="mt-4 grid gap-2 text-sm text-[color:var(--app-muted)] sm:grid-cols-2"><p className="flex items-center gap-2"><CalendarDays className="size-4" />{formatDate(detail.startsAt)}</p><p className="flex items-center gap-2"><MapPin className="size-4" />{detail.venueName || "Local não informado"}</p></div>
                <details className="mt-4 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
                  <summary className="cursor-pointer font-bold">Editar informações do evento</summary>
                  <form onSubmit={(event) => { event.preventDefault(); void saveEventForm(event.currentTarget); }} className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-semibold">Nome<input name="title" required defaultValue={detail.title} className={field} /></label>
                    <label className="text-sm font-semibold">Endereço curto<input name="eventSlug" required defaultValue={detail.eventSlug} className={field} /></label>
                    <label className="text-sm font-semibold">Data do evento<input name="startsAt" type="datetime-local" required defaultValue={localDateInput(new Date(detail.startsAt))} className={field} /></label>
                    <label className="text-sm font-semibold">Confirmar até<input name="deadline" type="datetime-local" required defaultValue={localDateInput(new Date(detail.confirmationDeadline))} className={field} /></label>
                    <label className="text-sm font-semibold">Local<input name="venueName" defaultValue={detail.venueName ?? ""} className={field} /></label>
                    <label className="text-sm font-semibold">Endereço<input name="venueAddress" defaultValue={detail.venueAddress ?? ""} className={field} /></label>
                    <label className="text-sm font-semibold md:col-span-2">Mensagem<textarea name="description" defaultValue={detail.description ?? ""} maxLength={2_000} rows={3} className={`${field} py-3`} /></label>
                    <button type="submit" className={`${primary} md:col-span-2 md:justify-self-start`} disabled={busy === "event-update"}><Save className="size-4" /> Salvar alterações</button>
                  </form>
                </details>
                <PresenceThemeSettings
                  detail={detail}
                  busy={busy === "event-update"}
                  onSave={updateEvent}
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  {(detail.status === "DRAFT" || detail.status === "ARCHIVED") ? <AlertDialog><AlertDialogTrigger asChild><button type="button" className={danger}><Trash2 className="size-4" /> Excluir evento</button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir este evento?</AlertDialogTitle><AlertDialogDescription>Convites, respostas e presentes serão removidos definitivamente.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void deleteEvent()}>Excluir definitivamente</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : <span className="inline-flex items-center gap-2 text-xs text-[color:var(--app-muted)]"><Archive className="size-4" /> Arquive antes de excluir</span>}
                </div>
              </section>

              <section className={`${panel} p-4 sm:p-5`}>
                <div className="mb-4 flex items-center gap-2"><UserRoundPlus className="size-5 text-[color:var(--app-action-green)]" /><h2 className="text-lg font-bold">Convidar pessoa</h2></div>
                <form onSubmit={(event) => { event.preventDefault(); void createGuest(event.currentTarget); }} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="text-sm font-semibold">Nome<input name="name" required maxLength={120} className={field} /></label>
                  <label className="text-sm font-semibold">E-mail opcional<input name="email" type="email" maxLength={254} className={field} /></label>
                  <label className="text-sm font-semibold">Identificação do link<input name="guestSlug" maxLength={80} className={field} placeholder="gerado pelo nome" /></label>
                  <label className="text-sm font-semibold">Acompanhantes<input name="companionLimit" type="number" min={0} max={20} defaultValue={0} className={field} /></label>
                  <button type="submit" className={primary} disabled={busy === "guest-create"}><Plus className="size-4" /> Gerar convite</button>
                </form>
                {latestLink ? <div className="mt-4 rounded-xl border border-[color:var(--app-action-green)] bg-[color:var(--app-surface)] p-3"><p className="text-sm font-bold">Link pronto. Ele só será exibido agora.</p><div className="mt-2 flex gap-2"><input readOnly value={latestLink} className={`${field} mt-0 min-w-0`} /><button type="button" className={secondary} aria-label="Copiar link" title="Copiar link" onClick={() => void navigator.clipboard.writeText(latestLink)}><Clipboard className="size-4" /></button></div></div> : null}
              </section>

              <section className={`${panel} overflow-hidden`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--app-border)] px-4 py-4 sm:px-5"><div className="flex items-center gap-2"><Users className="size-5 text-[color:var(--app-action-blue)]" /><h2 className="text-lg font-bold">Lista de presença</h2><span className="text-sm tabular-nums text-[color:var(--app-muted)]">{filteredGuests.length}/{detail.guests.length}</span></div><AlertDialog><AlertDialogTrigger asChild><button type="button" className={primary} disabled={detail.status !== "PUBLISHED" || busy === "delivery-send" || !detail.guests.some((guest) => guest.email)}>{busy === "delivery-send" ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />} Enviar por e-mail</button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Enviar convites por e-mail?</AlertDialogTitle><AlertDialogDescription>O envio será feito para todas as pessoas com e-mail cadastrado. Convites enviados anteriormente receberão um novo link individual.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void sendInvitations(detail.guests.filter((guest) => guest.email).map((guest) => guest.id))}>Enviar convites</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
                <div className="grid gap-3 border-b border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-4 py-3 sm:grid-cols-[minmax(0,1fr)_13rem] sm:px-5">
                  <label className="relative"><span className="sr-only">Buscar convidado</span><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-[color:var(--app-muted)]" aria-hidden="true" /><input value={guestSearch} onChange={(event) => setGuestSearch(event.target.value)} className={`${field} mt-0 pl-9`} placeholder="Buscar por nome ou e-mail" /></label>
                  <label><span className="sr-only">Filtrar respostas</span><select value={guestFilter} onChange={(event) => setGuestFilter(event.target.value as typeof guestFilter)} className={`${field} mt-0`}><option value="ALL">Todas as respostas</option><option value="PENDING">Aguardando</option><option value="CONFIRMED">Confirmados</option><option value="DECLINED">Não participarão</option></select></label>
                </div>
                <div className="max-h-[35rem] divide-y divide-[color:var(--app-border)] overflow-y-auto">
                  {filteredGuests.map((guest) => (
                    <div key={guest.id} className="p-4">
                      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <div className="min-w-0"><p className="truncate font-bold">{guest.name}</p><p className="truncate text-xs text-[color:var(--app-muted)]">{guest.email || `/${guest.guestSlug}`} · {rsvpLabel[guest.rsvpStatus]} · {guest.companionCount}/{guest.companionLimit} acompanhantes</p>{guest.deliveries[0] ? <p className="mt-1 flex items-center gap-1 text-xs text-[color:var(--app-muted)]"><Mail className="size-3.5" /> {deliveryLabel[guest.deliveries[0].status]}{guest.deliveries[0].sentAt ? ` em ${formatDate(guest.deliveries[0].sentAt)}` : ""}{guest.deliveries[0].attemptCount > 1 ? ` · ${guest.deliveries[0].attemptCount} tentativas` : ""}</p> : null}</div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={secondary} onClick={() => void guestAction(guest.id, "confirm")} disabled={busy === `guest-${guest.id}`}><Check className="size-4" /> Confirmar</button>
                          <button type="button" className={secondary} onClick={() => void guestAction(guest.id, "reset")} disabled={busy === `guest-${guest.id}`}>Aguardar</button>
                          <button type="button" className={secondary} onClick={() => void guestAction(guest.id, "decline")} disabled={busy === `guest-${guest.id}`}>Não participará</button>
                          <button type="button" className={secondary} title="Gerar novo link" onClick={() => void guestAction(guest.id, "link")} disabled={busy === `guest-${guest.id}`}><Link2 className="size-4" /> Renovar</button>
                          {guest.email ? <button type="button" className={secondary} onClick={() => isRetryableDelivery(guest.deliveries[0]?.status) ? void retryDelivery(guest.deliveries[0].id) : void sendInvitations([guest.id])} disabled={detail.status !== "PUBLISHED" || busy === "delivery-send" || busy === `delivery-${guest.deliveries[0]?.id}`}><Mail className="size-4" /> {isRetryableDelivery(guest.deliveries[0]?.status) ? "Tentar novamente" : ["SENT", "DELIVERED", "DELAYED"].includes(guest.deliveries[0]?.status ?? "") ? "Reenviar e-mail" : "Enviar e-mail"}</button> : null}
                          <AlertDialog><AlertDialogTrigger asChild><button type="button" className={danger} aria-label={`Excluir convite de ${guest.name}`}><Trash2 className="size-4" /></button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir convite?</AlertDialogTitle><AlertDialogDescription>O acesso de {guest.name} e suas reservas serão removidos.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void guestAction(guest.id, "delete")}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                        </div>
                      </div>
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer font-semibold text-[color:var(--app-muted)]">Editar convite</summary>
                        <form onSubmit={(event) => { event.preventDefault(); void saveGuest(guest.id, event.currentTarget); }} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <label className="font-semibold">Nome<input name="name" required defaultValue={guest.name} className={field} /></label>
                          <label className="font-semibold">E-mail<input name="email" type="email" defaultValue={guest.email ?? ""} className={field} /></label>
                          <label className="font-semibold">Identificação<input name="guestSlug" required defaultValue={guest.guestSlug} className={field} /></label>
                          <label className="font-semibold">Acompanhantes<input name="companionLimit" type="number" min={guest.companionCount} max={20} defaultValue={guest.companionLimit} className={field} /></label>
                          <button type="submit" className={`${primary} sm:col-span-2 lg:col-span-4 lg:justify-self-start`} disabled={busy === `guest-${guest.id}`}><Save className="size-4" /> Salvar convite</button>
                        </form>
                      </details>
                    </div>
                  ))}
                  {!detail.guests.length ? <p className="p-8 text-center text-sm text-[color:var(--app-muted)]">Adicione a primeira pessoa convidada.</p> : null}
                  {detail.guests.length && !filteredGuests.length ? <p className="p-8 text-center text-sm text-[color:var(--app-muted)]">Nenhum convite corresponde aos filtros.</p> : null}
                </div>
              </section>

              <PresenceGiftManager
                detail={detail}
                onRefresh={refresh}
                onError={setError}
              />
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
