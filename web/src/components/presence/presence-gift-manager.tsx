"use client";

import {
  ChevronDown,
  ChevronUp,
  Gift,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useState } from "react";
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
  type PresenceGiftAdmin,
  presenceApi,
} from "./presence-admin-model";

const panel = "rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 shadow-[var(--app-panel-shadow)] sm:p-5";
const field = "mt-1 min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 text-sm text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-action-blue)]";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-4 text-sm font-bold text-[color:var(--app-action-text)] hover:bg-[color:var(--app-action-blue-hover)] disabled:opacity-50";
const secondary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 text-sm font-semibold text-[color:var(--app-fg)] hover:border-[color:var(--app-action-blue)] disabled:opacity-50";
const danger = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-danger)] px-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50";

function reservationPayload(value: string) {
  if (value.startsWith("guest:")) {
    return { reservedManually: false, reservedByGuestId: value.slice(6) };
  }
  return {
    reservedManually: value === "MARKED",
    reservedByGuestId: null,
  };
}

function reservationValue(gift: PresenceGiftAdmin) {
  if (gift.reservedByGuest) return `guest:${gift.reservedByGuest.id}`;
  return gift.reservedManually ? "MARKED" : "AVAILABLE";
}

function ReservationSelect({ detail, gift }: { detail: PresenceEventDetail; gift?: PresenceGiftAdmin }) {
  const id = `gift-reservation-${gift?.id ?? "new"}`;
  return (
    <label className="text-sm font-semibold" htmlFor={id}>
      Situação
      <select id={id} name="reservation" defaultValue={gift ? reservationValue(gift) : "AVAILABLE"} className={field}>
        <option value="AVAILABLE">Disponível</option>
        <option value="MARKED">Já escolhido</option>
        <optgroup label="Vincular a uma pessoa">
          {detail.guests.map((guest) => <option key={guest.id} value={`guest:${guest.id}`}>{guest.name}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

export function PresenceGiftManager({
  detail,
  onRefresh,
  onError,
}: {
  detail: PresenceEventDetail;
  onRefresh: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
      await onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Não foi possível atualizar a lista de presentes.");
    } finally {
      setBusy(null);
    }
  }

  function categoryPayload(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      name: String(data.get("name") ?? ""),
      emoji: String(data.get("emoji") ?? "🏠") || "🏠",
    };
  }

  function giftPayload(form: HTMLFormElement) {
    const data = new FormData(form);
    return {
      categoryId: String(data.get("categoryId") ?? "") || null,
      emoji: String(data.get("emoji") ?? "🎁") || "🎁",
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      externalUrl: String(data.get("externalUrl") ?? "") || null,
      ...reservationPayload(String(data.get("reservation") ?? "AVAILABLE")),
    };
  }

  async function moveCategory(index: number, delta: number) {
    const categories = [...detail.giftCategories];
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    [categories[index], categories[target]] = [categories[target], categories[index]];
    await run("category-order", () => presenceApi(`/api/admin/presencas/${detail.id}/categorias-presentes`, {
      method: "PATCH",
      body: JSON.stringify({ orderedIds: categories.map((category) => category.id) }),
    }));
  }

  async function moveGift(gift: PresenceGiftAdmin, delta: number) {
    const peers = detail.gifts.filter((item) => item.categoryId === gift.categoryId);
    const peerIndex = peers.findIndex((item) => item.id === gift.id);
    const target = peerIndex + delta;
    if (target < 0 || target >= peers.length) return;
    const ordered = [...detail.gifts];
    const left = ordered.findIndex((item) => item.id === peers[peerIndex].id);
    const right = ordered.findIndex((item) => item.id === peers[target].id);
    [ordered[left], ordered[right]] = [ordered[right], ordered[left]];
    await run("gift-order", () => presenceApi(`/api/admin/presencas/${detail.id}/presentes`, {
      method: "PATCH",
      body: JSON.stringify({ orderedIds: ordered.map((item) => item.id) }),
    }));
  }

  const categoryGroups = [
    ...detail.giftCategories.map((category) => ({ ...category, gifts: detail.gifts.filter((gift) => gift.categoryId === category.id) })),
    { id: "uncategorized", name: "Sem categoria", emoji: "🎁", position: Number.MAX_SAFE_INTEGER, _count: { gifts: 0 }, gifts: detail.gifts.filter((gift) => !gift.categoryId) },
  ].filter((group) => group.id !== "uncategorized" || group.gifts.length > 0);

  return (
    <section className={panel}>
      <div className="flex items-center gap-2">
        <Gift className="size-5 text-[color:var(--app-action-green)]" aria-hidden="true" />
        <div><h2 className="text-lg font-bold">Lista de presentes</h2><p className="text-sm text-[color:var(--app-muted)]">Organize por cômodo ou por qualquer categoria que faça sentido.</p></div>
      </div>

      <details className="mt-5 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
        <summary className="cursor-pointer font-bold">Categorias</summary>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void run("category-create", async () => {
              await presenceApi(`/api/admin/presencas/${detail.id}/categorias-presentes`, { method: "POST", body: JSON.stringify(categoryPayload(form)) });
              form.reset();
            });
          }}
        >
          <label className="text-sm font-semibold">Emoji<input name="emoji" maxLength={16} defaultValue="🏠" className={`${field} text-center text-xl`} /></label>
          <label className="text-sm font-semibold">Nome da categoria<input name="name" required maxLength={80} className={field} placeholder="Cozinha, quarto, sala..." /></label>
          <button type="submit" className={`${primary} self-end`} disabled={busy === "category-create"}><Plus className="size-4" /> Criar</button>
        </form>
        <div className="mt-4 divide-y divide-[color:var(--app-border)]">
          {detail.giftCategories.map((category, index) => (
            <form
              key={category.id}
              className="grid gap-2 py-3 sm:grid-cols-[auto_5rem_minmax(0,1fr)_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                void run(`category-${category.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/categorias-presentes/${category.id}`, { method: "PATCH", body: JSON.stringify(categoryPayload(form)) }));
              }}
            >
              <div className="flex gap-1 self-end"><button type="button" className={secondary} aria-label={`Mover ${category.name} para cima`} disabled={index === 0 || busy === "category-order"} onClick={() => void moveCategory(index, -1)}><ChevronUp className="size-4" /></button><button type="button" className={secondary} aria-label={`Mover ${category.name} para baixo`} disabled={index === detail.giftCategories.length - 1 || busy === "category-order"} onClick={() => void moveCategory(index, 1)}><ChevronDown className="size-4" /></button></div>
              <label className="text-xs font-semibold">Emoji<input name="emoji" maxLength={16} defaultValue={category.emoji} className={`${field} text-center text-xl`} /></label>
              <label className="text-xs font-semibold">Categoria<input name="name" required maxLength={80} defaultValue={category.name} className={field} /></label>
              <div className="flex gap-2 self-end"><button type="submit" className={secondary} disabled={busy === `category-${category.id}`}><Save className="size-4" /> Salvar</button><AlertDialog><AlertDialogTrigger asChild><button type="button" className={danger} aria-label={`Excluir categoria ${category.name}`}><Trash2 className="size-4" /></button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir esta categoria?</AlertDialogTitle><AlertDialogDescription>Os {category._count.gifts} presentes serão mantidos e movidos para “Sem categoria”.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void run(`category-${category.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/categorias-presentes/${category.id}`, { method: "DELETE" }))}>Excluir categoria</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
            </form>
          ))}
          {!detail.giftCategories.length && <p className="py-4 text-sm text-[color:var(--app-muted)]">Crie sua primeira categoria, por exemplo Cozinha ou Quarto.</p>}
        </div>
      </details>

      <form
        className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          void run("gift-create", async () => {
            await presenceApi(`/api/admin/presencas/${detail.id}/presentes`, { method: "POST", body: JSON.stringify({ ...giftPayload(form), active: true }) });
            form.reset();
          });
        }}
      >
        <label className="text-sm font-semibold">Presente<div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2"><input name="emoji" maxLength={16} defaultValue="🎁" aria-label="Emoji do presente" className={`${field} text-center text-xl`} /><input name="title" required maxLength={160} className={field} placeholder="Nome do presente" /></div></label>
        <label className="text-sm font-semibold">Categoria<select name="categoryId" className={field}><option value="">Sem categoria</option>{detail.giftCategories.map((category) => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}</select></label>
        <ReservationSelect detail={detail} />
        <label className="text-sm font-semibold">Link opcional<input name="externalUrl" type="url" maxLength={2_000} className={field} /></label>
        <label className="text-sm font-semibold md:col-span-2 xl:col-span-3">Descrição<input name="description" maxLength={500} className={field} /></label>
        <button type="submit" className={`${primary} self-end`} disabled={busy === "gift-create"}><Plus className="size-4" /> Adicionar presente</button>
      </form>

      <div className="mt-6 space-y-5">
        {categoryGroups.map((group) => (
          <section key={group.id} aria-labelledby={`admin-gift-category-${group.id}`}>
            <div className="mb-2 flex items-center gap-2"><span className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-surface)] text-xl" aria-hidden="true">{group.emoji}</span><h3 id={`admin-gift-category-${group.id}`} className="font-bold">{group.name}</h3><span className="text-xs tabular-nums text-[color:var(--app-muted)]">{group.gifts.length}</span></div>
            <div className="space-y-2">
              {group.gifts.map((gift, index) => (
                <div key={gift.id} className="rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
                  <div className="flex flex-wrap items-center gap-3"><div className="flex gap-1"><button type="button" className={secondary} aria-label={`Mover ${gift.title} para cima`} disabled={index === 0 || busy === "gift-order"} onClick={() => void moveGift(gift, -1)}><ChevronUp className="size-4" /></button><button type="button" className={secondary} aria-label={`Mover ${gift.title} para baixo`} disabled={index === group.gifts.length - 1 || busy === "gift-order"} onClick={() => void moveGift(gift, 1)}><ChevronDown className="size-4" /></button></div><span className="grid size-11 place-items-center rounded-lg bg-[color:var(--app-card)] text-2xl" aria-hidden="true">{gift.emoji}</span><div className="min-w-48 flex-1"><p className={`font-bold ${gift.active ? "" : "line-through opacity-60"}`}>{gift.title}</p><p className="text-xs text-[color:var(--app-muted)]">{gift.reservedByGuest ? `Escolhido por ${gift.reservedByGuest.name}` : gift.reservedManually ? "Já escolhido" : "Disponível"}</p></div><button type="button" className={secondary} onClick={() => void run(`gift-${gift.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/presentes/${gift.id}`, { method: "PATCH", body: JSON.stringify({ active: !gift.active }) }))}>{gift.active ? "Ocultar" : "Exibir"}</button>{(gift.reservedByGuest || gift.reservedManually) ? <button type="button" className={secondary} onClick={() => void run(`gift-${gift.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/presentes/${gift.id}`, { method: "PATCH", body: JSON.stringify({ clearReservation: true }) }))}>Liberar</button> : <AlertDialog><AlertDialogTrigger asChild><button type="button" className={danger} aria-label={`Excluir ${gift.title}`}><Trash2 className="size-4" /></button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir presente?</AlertDialogTitle><AlertDialogDescription>{gift.title} será removido da lista.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void run(`gift-${gift.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/presentes/${gift.id}`, { method: "DELETE" }))}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div>
                  <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-[color:var(--app-muted)]">Editar presente</summary><form className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; void run(`gift-${gift.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/presentes/${gift.id}`, { method: "PATCH", body: JSON.stringify(giftPayload(form)) })); }}><label className="font-semibold">Presente<div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2"><input name="emoji" maxLength={16} defaultValue={gift.emoji} aria-label={`Emoji de ${gift.title}`} className={`${field} text-center text-xl`} /><input name="title" required defaultValue={gift.title} className={field} /></div></label><label className="font-semibold">Categoria<select name="categoryId" defaultValue={gift.categoryId ?? ""} className={field}><option value="">Sem categoria</option>{detail.giftCategories.map((category) => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}</select></label><ReservationSelect detail={detail} gift={gift} /><label className="font-semibold">Link<input name="externalUrl" type="url" defaultValue={gift.externalUrl ?? ""} className={field} /></label><label className="font-semibold md:col-span-2 xl:col-span-4">Descrição<input name="description" defaultValue={gift.description ?? ""} className={field} /></label><button type="submit" className={`${primary} md:col-span-2 md:justify-self-start xl:col-span-4`} disabled={busy === `gift-${gift.id}`}><Save className="size-4" /> Salvar presente</button></form></details>
                </div>
              ))}
            </div>
          </section>
        ))}
        {!detail.gifts.length && <p className="rounded-xl border border-dashed border-[color:var(--app-border)] p-8 text-center text-sm text-[color:var(--app-muted)]">Adicione o primeiro presente da lista.</p>}
      </div>
    </section>
  );
}
