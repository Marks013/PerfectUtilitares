"use client";

import {
  ChevronDown,
  ChevronUp,
  Gift,
  ListFilter,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
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

const categoryEmojiOptions = [
  ["🏠", "Casa"],
  ["🏡", "Lar"],
  ["🏢", "Apartamento"],
  ["🍳", "Cozinha"],
  ["🧑‍🍳", "Cozinha gourmet"],
  ["🛋️", "Sala"],
  ["📺", "Sala de TV"],
  ["🍽️", "Sala de jantar"],
  ["🛏️", "Quarto"],
  ["👗", "Closet"],
  ["🛁", "Banheiro"],
  ["🧺", "Lavanderia"],
  ["🧹", "Limpeza"],
  ["💻", "Escritório"],
  ["📚", "Biblioteca"],
  ["🧸", "Quarto infantil"],
  ["👶", "Bebê"],
  ["🎮", "Lazer"],
  ["🎉", "Festa"],
  ["🧰", "Ferramentas"],
  ["🚗", "Garagem"],
  ["🏊", "Piscina"],
  ["🍖", "Churrasqueira"],
  ["🌻", "Jardim"],
  ["🌿", "Área externa"],
  ["🐾", "Animais"],
  ["✈️", "Viagem"],
  ["💝", "Cotas especiais"],
  ["✨", "Outros"],
] as const;

const giftEmojiOptions = [
  ["🎁", "Presente"],
  ["🎀", "Lembrança"],
  ["💝", "Presente especial"],
  ["🍽️", "Mesa"],
  ["🍴", "Talheres"],
  ["🥄", "Utensílios"],
  ["🥣", "Tigelas"],
  ["🍲", "Panelas"],
  ["🥘", "Frigideira"],
  ["🫖", "Bule"],
  ["🍷", "Taças"],
  ["🥂", "Brinde"],
  ["🥃", "Copos"],
  ["☕", "Café"],
  ["🍳", "Cozinha"],
  ["🔪", "Utensílios"],
  ["🧊", "Geladeira"],
  ["🔥", "Fogão"],
  ["🧁", "Confeitaria"],
  ["🛏️", "Cama"],
  ["🛌", "Roupa de cama"],
  ["🪞", "Espelho"],
  ["👗", "Vestuário"],
  ["🛁", "Banho"],
  ["🧴", "Cuidados"],
  ["🧺", "Lavanderia"],
  ["🧹", "Limpeza"],
  ["🪣", "Organização"],
  ["🪴", "Decoração"],
  ["🖼️", "Quadro"],
  ["🕯️", "Vela"],
  ["🕰️", "Relógio"],
  ["💡", "Iluminação"],
  ["🛋️", "Móvel"],
  ["🪑", "Cadeira"],
  ["📺", "Eletrônico"],
  ["🔊", "Áudio"],
  ["📱", "Tecnologia"],
  ["💻", "Informática"],
  ["🎮", "Jogos"],
  ["🧸", "Infantil"],
  ["👶", "Bebê"],
  ["🐾", "Pet"],
  ["🧰", "Ferramenta"],
  ["🌻", "Jardim"],
  ["🏕️", "Área externa"],
  ["🚗", "Automóvel"],
  ["✈️", "Viagem"],
  ["🏨", "Lua de mel"],
  ["🎟️", "Experiência"],
  ["💵", "Contribuição"],
  ["💳", "Cota"],
  ["✨", "Outro"],
] as const;

function EmojiPicker({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  const [value, setValue] = useState(defaultValue);

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-semibold">{label}</legend>
      <input type="hidden" name={name} value={value} />
      <details className="relative mt-1 min-w-0">
        <summary
          className="flex min-h-11 w-full cursor-pointer list-none items-center gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 text-sm font-semibold hover:border-[color:var(--app-action-blue)]"
          aria-label={`${label}: ${value}`}
        >
          <span className="text-2xl" aria-hidden="true">{value}</span>
          <span>Escolher</span>
        </summary>
        <div className="absolute left-0 top-full z-20 mt-2 grid w-80 max-w-[calc(100vw-3rem)] grid-cols-5 gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-2 shadow-[var(--app-panel-shadow)] sm:grid-cols-6">
          {options.map(([emoji, optionLabel]) => (
            <button
              key={`${emoji}-${optionLabel}`}
              type="button"
              className={`grid min-h-11 place-items-center rounded-lg border text-xl transition duration-150 ${
                value === emoji
                  ? "border-[color:var(--app-action-blue)] bg-[color:var(--app-surface)]"
                  : "border-transparent hover:border-[color:var(--app-border)]"
              }`}
              aria-label={optionLabel}
              aria-pressed={value === emoji}
              title={optionLabel}
              onClick={(event) => {
                setValue(emoji);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </details>
    </fieldset>
  );
}

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

function QuantityFields({ gift }: { gift?: PresenceGiftAdmin }) {
  return (
    <>
      <label className="text-sm font-semibold">
        Disponibilidade
        <select
          name="availability"
          defaultValue={gift?.quantity === null ? "UNLIMITED" : "LIMITED"}
          className={field}
        >
          <option value="LIMITED">Quantidade definida</option>
          <option value="UNLIMITED">Ilimitado</option>
        </select>
      </label>
      <label className="text-sm font-semibold">
        Quantidade
        <input
          name="quantity"
          type="number"
          min={1}
          max={9_999}
          defaultValue={gift?.quantity ?? 1}
          className={field}
        />
      </label>
    </>
  );
}

function giftIsFull(gift: PresenceGiftAdmin) {
  return gift.quantity !== null && gift.reservedCount >= gift.quantity;
}

function giftHasSelections(gift: PresenceGiftAdmin) {
  return gift.reservedCount > 0;
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

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
    const availability = String(data.get("availability") ?? "LIMITED");
    const parsedQuantity = Number(data.get("quantity") ?? 1);
    const normalizedQuantity =
      Number.isFinite(parsedQuantity) && parsedQuantity >= 1
        ? Math.min(9_999, Math.trunc(parsedQuantity))
        : 1;
    return {
      categoryId: String(data.get("categoryId") ?? "") || null,
      emoji: String(data.get("emoji") ?? "🎁") || "🎁",
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      externalUrl: String(data.get("externalUrl") ?? "") || null,
      quantity: availability === "UNLIMITED" ? null : normalizedQuantity,
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

  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const filteredGifts = useMemo(
    () => detail.gifts.filter((gift) => {
      const selected = giftHasSelections(gift);
      const matchesQuery =
        !normalizedQuery ||
        gift.title.toLocaleLowerCase("pt-BR").includes(normalizedQuery) ||
        gift.description?.toLocaleLowerCase("pt-BR").includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "ALL" ||
        (statusFilter === "AVAILABLE" && gift.active && !giftIsFull(gift)) ||
        (statusFilter === "RESERVED" && selected) ||
        (statusFilter === "HIDDEN" && !gift.active);
      const matchesCategory =
        categoryFilter === "ALL" ||
        (categoryFilter === "UNCATEGORIZED" && !gift.categoryId) ||
        gift.categoryId === categoryFilter;
      return matchesQuery && matchesStatus && matchesCategory;
    }).sort((left, right) => {
      const selectedFirst =
        Number(giftHasSelections(right)) - Number(giftHasSelections(left));
      if (selectedFirst !== 0) return selectedFirst;
      return left.position - right.position;
    }),
    [categoryFilter, detail.gifts, normalizedQuery, statusFilter],
  );
  const hasFilters = Boolean(normalizedQuery) || statusFilter !== "ALL" || categoryFilter !== "ALL";
  const categoryGroups = useMemo(
    () => [
      ...detail.giftCategories.map((category) => ({
        ...category,
        gifts: filteredGifts.filter((gift) => gift.categoryId === category.id),
      })),
      {
        id: "uncategorized",
        name: "Sem categoria",
        emoji: "🎁",
        position: Number.MAX_SAFE_INTEGER,
        _count: { gifts: 0 },
        gifts: filteredGifts.filter((gift) => !gift.categoryId),
      },
    ].filter((group) =>
      hasFilters
        ? group.gifts.length > 0
        : group.id !== "uncategorized" || group.gifts.length > 0,
    ).sort((left, right) => {
      const selectedFirst =
        Number(right.gifts.some(giftHasSelections)) -
        Number(left.gifts.some(giftHasSelections));
      if (selectedFirst !== 0) return selectedFirst;
      return left.position - right.position;
    }),
    [detail.giftCategories, filteredGifts, hasFilters],
  );
  const reservedCount = detail.gifts.reduce(
    (total, gift) => total + gift.reservedCount,
    0,
  );

  return (
    <section className={panel}>
      <div className="flex items-center gap-2">
        <Gift className="size-5 text-[color:var(--app-action-green)]" aria-hidden="true" />
        <div><h2 className="text-lg font-bold">Lista de presentes</h2><p className="text-sm text-[color:var(--app-muted)]">Organize por cômodo ou por qualquer categoria que faça sentido. Itens escolhidos aparecem primeiro e ficam destacados.</p></div>
      </div>

      <details className="mt-5 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
        <summary className="cursor-pointer font-bold">Categorias</summary>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void run("category-create", async () => {
              await presenceApi(`/api/admin/presencas/${detail.id}/categorias-presentes`, { method: "POST", body: JSON.stringify(categoryPayload(form)) });
              form.reset();
            });
          }}
        >
          <EmojiPicker
            name="emoji"
            label="Ícone"
            defaultValue="🏠"
            options={categoryEmojiOptions}
          />
          <label className="text-sm font-semibold">Nome da categoria<input name="name" required maxLength={80} className={field} placeholder="Cozinha, quarto, sala..." /></label>
          <button type="submit" className={`${primary} self-end`} disabled={busy === "category-create"}><Plus className="size-4" /> Criar</button>
        </form>
        <div className="mt-4 divide-y divide-[color:var(--app-border)]">
          {detail.giftCategories.map((category, index) => (
            <form
              key={category.id}
              className="grid gap-2 py-3 sm:grid-cols-[auto_9rem_minmax(0,1fr)_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                void run(`category-${category.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/categorias-presentes/${category.id}`, { method: "PATCH", body: JSON.stringify(categoryPayload(form)) }));
              }}
            >
              <div className="flex gap-1 self-end"><button type="button" className={secondary} aria-label={`Mover ${category.name} para cima`} disabled={index === 0 || busy === "category-order"} onClick={() => void moveCategory(index, -1)}><ChevronUp className="size-4" /></button><button type="button" className={secondary} aria-label={`Mover ${category.name} para baixo`} disabled={index === detail.giftCategories.length - 1 || busy === "category-order"} onClick={() => void moveCategory(index, 1)}><ChevronDown className="size-4" /></button></div>
              <EmojiPicker
                name="emoji"
                label="Ícone"
                defaultValue={category.emoji}
                options={categoryEmojiOptions}
              />
              <label className="text-xs font-semibold">Categoria<input name="name" required maxLength={80} defaultValue={category.name} className={field} /></label>
              <div className="flex gap-2 self-end"><button type="submit" className={secondary} disabled={busy === `category-${category.id}`}><Save className="size-4" /> Salvar</button><AlertDialog><AlertDialogTrigger asChild><button type="button" className={danger} aria-label={`Excluir categoria ${category.name}`}><Trash2 className="size-4" /></button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir esta categoria?</AlertDialogTitle><AlertDialogDescription>Os {category._count.gifts} presentes serão mantidos e movidos para “Sem categoria”.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void run(`category-${category.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/categorias-presentes/${category.id}`, { method: "DELETE" }))}>Excluir categoria</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
            </form>
          ))}
          {!detail.giftCategories.length && <p className="py-4 text-sm text-[color:var(--app-muted)]">Crie sua primeira categoria, por exemplo Cozinha ou Quarto.</p>}
        </div>
      </details>

      <form
        className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          void run("gift-create", async () => {
            await presenceApi(`/api/admin/presencas/${detail.id}/presentes`, { method: "POST", body: JSON.stringify({ ...giftPayload(form), active: true }) });
            form.reset();
          });
        }}
      >
        <EmojiPicker
          name="emoji"
          label="Ícone"
          defaultValue="🎁"
          options={giftEmojiOptions}
        />
        <label className="text-sm font-semibold">Presente<input name="title" required maxLength={160} className={field} placeholder="Nome do presente" /></label>
        <label className="text-sm font-semibold">Categoria<select name="categoryId" className={field}><option value="">Sem categoria</option>{detail.giftCategories.map((category) => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}</select></label>
        <ReservationSelect detail={detail} />
        <QuantityFields />
        <label className="text-sm font-semibold">Link opcional<input name="externalUrl" type="url" maxLength={2_000} className={field} /></label>
        <label className="text-sm font-semibold md:col-span-2 xl:col-span-4">Descrição<input name="description" maxLength={500} className={field} /></label>
        <button type="submit" className={`${primary} self-end`} disabled={busy === "gift-create"}><Plus className="size-4" /> Adicionar presente</button>
      </form>

      <div className="mt-6 grid gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold tabular-nums text-[color:var(--app-muted)]">
            <span>{detail.gifts.length} presentes</span>
            <span aria-hidden="true">•</span>
            <span>{detail.gifts.filter((gift) => gift.active && !giftIsFull(gift)).length} disponíveis</span>
            <span aria-hidden="true">•</span>
            <span>{reservedCount} escolhas</span>
          </div>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--app-muted)]" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={`${field} mt-0 pl-9`}
              placeholder="Buscar presente"
              aria-label="Buscar presente"
            />
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold">
            Situação
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={field}>
              <option value="ALL">Todas</option>
              <option value="AVAILABLE">Disponíveis</option>
              <option value="RESERVED">Escolhidos</option>
              <option value="HIDDEN">Ocultos</option>
            </select>
          </label>
          <label className="text-xs font-semibold">
            Categoria
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={field}>
              <option value="ALL">Todas</option>
              <option value="UNCATEGORIZED">Sem categoria</option>
              {detail.giftCategories.map((category) => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="mt-6 space-y-5">
        {categoryGroups.map((group) => (
          <section key={group.id} aria-labelledby={`admin-gift-category-${group.id}`}>
            <div className="mb-2 flex items-center gap-2"><span className="grid size-9 place-items-center rounded-lg bg-[color:var(--app-surface)] text-xl" aria-hidden="true">{group.emoji}</span><h3 id={`admin-gift-category-${group.id}`} className="font-bold">{group.name}</h3><span className="text-xs tabular-nums text-[color:var(--app-muted)]">{group.gifts.length}</span></div>
            <div className="space-y-2">
              {group.gifts.map((gift, index) => (
                <div
                  key={gift.id}
                  className={`rounded-xl border p-3 transition ${
                    giftHasSelections(gift)
                      ? "border-2 border-[color:var(--app-action-green)] bg-[color:var(--app-card)] shadow-sm"
                      : "border-[color:var(--app-border)] bg-[color:var(--app-surface)]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3"><div className="flex gap-1"><button type="button" className={secondary} aria-label={`Mover ${gift.title} para cima`} disabled={index === 0 || busy === "gift-order"} onClick={() => void moveGift(gift, -1)}><ChevronUp className="size-4" /></button><button type="button" className={secondary} aria-label={`Mover ${gift.title} para baixo`} disabled={index === group.gifts.length - 1 || busy === "gift-order"} onClick={() => void moveGift(gift, 1)}><ChevronDown className="size-4" /></button></div><span className="grid size-11 place-items-center rounded-lg bg-[color:var(--app-card)] text-2xl" aria-hidden="true">{gift.emoji}</span><div className="min-w-48 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`font-bold ${gift.active ? "" : "line-through opacity-60"}`}>{gift.title}</p>
                      {giftHasSelections(gift) && (
                        <span className="inline-flex rounded-full bg-[color:var(--app-action-green)] px-2 py-0.5 text-[11px] font-bold text-white">
                          Escolhido · {gift.reservedCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[color:var(--app-muted)]">{gift.quantity === null ? `Ilimitado · ${gift.reservedCount} escolha(s)` : `${gift.reservedCount}/${gift.quantity} escolhido(s) · ${gift.availableCount ?? 0} disponível(is)`}</p>
                  </div><label className="text-xs font-semibold text-[color:var(--app-muted)]"><span className="sr-only">Mover {gift.title} para outra categoria</span><select aria-label={`Mover ${gift.title} para outra categoria`} defaultValue={gift.categoryId ?? ""} className="min-h-10 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] px-2 text-sm text-[color:var(--app-fg)]" disabled={busy === `gift-${gift.id}`} onChange={(event) => void run(`gift-${gift.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/presentes/${gift.id}`, { method: "PATCH", body: JSON.stringify({ categoryId: event.target.value || null }) }))}><option value="">Sem categoria</option>{detail.giftCategories.map((category) => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}</select></label><button type="button" className={secondary} onClick={() => void run(`gift-${gift.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/presentes/${gift.id}`, { method: "PATCH", body: JSON.stringify({ active: !gift.active }) }))}>{gift.active ? "Ocultar" : "Exibir"}</button>{(gift.reservedCount > 0) ? <button type="button" className={secondary} onClick={() => void run(`gift-${gift.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/presentes/${gift.id}`, { method: "PATCH", body: JSON.stringify({ clearReservation: true }) }))}>Liberar</button> : <AlertDialog><AlertDialogTrigger asChild><button type="button" className={danger} aria-label={`Excluir ${gift.title}`}><Trash2 className="size-4" /></button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir presente?</AlertDialogTitle><AlertDialogDescription>{gift.title} será removido da lista.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void run(`gift-${gift.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/presentes/${gift.id}`, { method: "DELETE" }))}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</div>
                  <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-[color:var(--app-muted)]">Editar presente</summary><form className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; void run(`gift-${gift.id}`, () => presenceApi(`/api/admin/presencas/${detail.id}/presentes/${gift.id}`, { method: "PATCH", body: JSON.stringify(giftPayload(form)) })); }}><EmojiPicker name="emoji" label="Ícone" defaultValue={gift.emoji} options={giftEmojiOptions} /><label className="font-semibold">Presente<input name="title" required defaultValue={gift.title} className={field} /></label><label className="font-semibold">Categoria<select name="categoryId" defaultValue={gift.categoryId ?? ""} className={field}><option value="">Sem categoria</option>{detail.giftCategories.map((category) => <option key={category.id} value={category.id}>{category.emoji} {category.name}</option>)}</select></label><ReservationSelect detail={detail} gift={gift} /><QuantityFields gift={gift} /><label className="font-semibold">Link<input name="externalUrl" type="url" defaultValue={gift.externalUrl ?? ""} className={field} /></label><label className="font-semibold md:col-span-2 xl:col-span-5">Descrição<input name="description" defaultValue={gift.description ?? ""} className={field} /></label><button type="submit" className={`${primary} md:col-span-2 md:justify-self-start xl:col-span-5`} disabled={busy === `gift-${gift.id}`}><Save className="size-4" /> Salvar presente</button></form></details>
                </div>
              ))}
            </div>
          </section>
        ))}
        {detail.gifts.length > 0 && filteredGifts.length === 0 && <div className="rounded-xl border border-dashed border-[color:var(--app-border)] p-8 text-center"><ListFilter className="mx-auto size-5 text-[color:var(--app-muted)]" aria-hidden="true" /><p className="mt-2 text-sm text-[color:var(--app-muted)]">Nenhum presente corresponde aos filtros.</p></div>}
        {!detail.gifts.length && <p className="rounded-xl border border-dashed border-[color:var(--app-border)] p-8 text-center text-sm text-[color:var(--app-muted)]">Adicione o primeiro presente da lista.</p>}
      </div>
    </section>
  );
}
