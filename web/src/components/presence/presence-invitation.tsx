"use client";

import {
  CalendarDays,
  Check,
  ExternalLink,
  Gift,
  LoaderCircle,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  UserRoundCheck,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  type PresenceCover,
  presenceCover,
} from "@/lib/presence/cover";
import styles from "./presence-invitation.module.css";

type PresenceState = {
  revision: number;
  event: {
    title: string;
    description: string | null;
    startsAt: string;
    venueName: string | null;
    venueAddress: string | null;
    confirmationDeadline: string;
    timeZone: string;
    status: "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
    confirmationOpen: boolean;
    theme: {
      preset: "CELEBRATION" | "ELEGANT" | "GARDEN" | "NIGHT";
      cover: PresenceCover;
      accent: "CORAL" | "BLUE" | "GREEN" | "GOLD";
      welcomeTitle: string | null;
    };
  };
  guest: {
    name: string;
    rsvpStatus: "PENDING" | "CONFIRMED" | "DECLINED";
    adultCount: number;
    childCount: number;
  };
  gifts: Array<{
    id: string;
    emoji: string;
    category: {
      id: string;
      name: string;
      emoji: string;
      position: number;
    } | null;
    title: string;
    description: string | null;
    externalUrl: string | null;
    quantity: number | null;
    reservedCount: number;
    availableCount: number | null;
    unlimited: boolean;
    reserved: boolean;
    reservedByMe: boolean;
  }>;
};

type Props = { eventSlug: string; guestSlug: string };
type RequestError = { error?: { message?: string } };
type ConfirmationResult = {
  revision: number;
  rsvpStatus: "CONFIRMED" | "DECLINED";
  adultCount: number;
  childCount: number;
};

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as RequestError | null;
  return body?.error?.message ?? fallback;
}

export function PresenceInvitation({ eventSlug, guestSlug }: Props) {
  const [state, setState] = useState<PresenceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adultCount, setAdultCount] = useState(0);
  const [childCount, setChildCount] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const etagRef = useRef<string | null>(null);
  const attendanceDirtyRef = useRef(false);

  const stateUrl = `/api/presenca/${eventSlug}/${guestSlug}/estado`;

  const loadState = useCallback(
    async (quiet = false) => {
      const response = await fetch(stateUrl, {
        cache: "no-store",
        headers: etagRef.current ? { "If-None-Match": etagRef.current } : {},
      });
      if (response.status === 304) return;
      if (!response.ok) {
        if (!quiet) {
          throw new Error(
            await errorMessage(response, "Não foi possível abrir este convite."),
          );
        }
        return;
      }
      const nextState = (await response.json()) as PresenceState;
      etagRef.current = response.headers.get("etag");
      setState(nextState);
      if (!attendanceDirtyRef.current) {
        setAdultCount(nextState.guest.adultCount);
        setChildCount(nextState.guest.childCount);
      }
    },
    [stateUrl],
  );

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        const token = window.location.hash.slice(1);
        if (token) {
          const response = await fetch("/api/presenca/acesso", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventSlug, guestSlug, token }),
          });
          if (!response.ok) {
            throw new Error(
              await errorMessage(response, "Este convite não está disponível."),
            );
          }
          window.history.replaceState(null, "", window.location.pathname);
        }
        await loadState();
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Não foi possível abrir este convite.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void start();
    return () => {
      active = false;
    };
  }, [eventSlug, guestSlug, loadState]);

  useEffect(() => {
    if (!state) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadState(true);
    };
    const timer = window.setInterval(refreshWhenVisible, 5_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadState, state]);

  async function confirm(status: "CONFIRMED" | "DECLINED") {
    if (status === "CONFIRMED" && adultCount === 0) {
      setNotice(null);
      setError("Informe ao menos um adulto antes de confirmar. Crianças são opcionais.");
      return;
    }
    setPendingAction("rsvp");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/presenca/${eventSlug}/${guestSlug}/confirmacao`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            adultCount: status === "CONFIRMED" ? adultCount : 0,
            childCount: status === "CONFIRMED" ? childCount : 0,
          }),
        },
      );
      if (!response.ok) {
        setError(
          await errorMessage(response, "Não foi possível salvar sua resposta."),
        );
      } else {
        const result = (await response.json()) as ConfirmationResult;
        etagRef.current = null;
        setState((current) =>
          current
            ? {
                ...current,
                revision: result.revision,
                guest: {
                  ...current.guest,
                  rsvpStatus: result.rsvpStatus,
                  adultCount: result.adultCount,
                  childCount: result.childCount,
                },
              }
            : current,
        );
        attendanceDirtyRef.current = false;
        setAdultCount(result.adultCount);
        setChildCount(result.childCount);
        void loadState(true);
        setNotice(
          status === "CONFIRMED"
            ? "Presença confirmada. Que bom ter você com a gente!"
            : "Resposta atualizada. Sentiremos sua falta.",
        );
      }
    } catch {
      setError("A conexão falhou. Verifique sua internet e tente novamente.");
    } finally {
      setPendingAction(null);
    }
  }

  async function toggleGift(giftId: string, reservedByMe: boolean) {
    setPendingAction(giftId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/presenca/${eventSlug}/${guestSlug}/presentes/${giftId}/reserva`,
        { method: reservedByMe ? "DELETE" : "POST" },
      );
      if (!response.ok) {
        setError(
          await errorMessage(response, "Não foi possível atualizar o presente."),
        );
      } else {
        etagRef.current = null;
        await loadState();
        setNotice(
          reservedByMe ? "Presente liberado." : "Presente escolhido para você.",
        );
      }
    } catch {
      setError("A conexão falhou. Verifique sua internet e tente novamente.");
    } finally {
      setPendingAction(null);
    }
  }

  if (loading) {
    return (
      <main className={styles.centered} aria-busy="true">
        <LoaderCircle className={styles.spinner} aria-hidden="true" />
        <p>Abrindo seu convite...</p>
      </main>
    );
  }

  if (error && !state) {
    return (
      <main className={styles.centered}>
        <div className={styles.errorMark}><X aria-hidden="true" /></div>
        <h1>Convite indisponível</h1>
        <p>{error}</p>
        <button type="button" className={styles.secondaryButton} onClick={() => location.reload()}>
          <RefreshCw aria-hidden="true" /> Tentar novamente
        </button>
      </main>
    );
  }

  if (!state) return null;
  const { event, guest, gifts } = state;
  const attendanceUnchanged =
    adultCount === guest.adultCount && childCount === guest.childCount;
  const confirmationSaved =
    guest.rsvpStatus === "CONFIRMED" && attendanceUnchanged;
  const cover = presenceCover(event.theme.cover);
  const giftGroups = Array.from(
    gifts.reduce((groups, gift) => {
      const key = gift.category?.id ?? "uncategorized";
      const current = groups.get(key) ?? {
        id: key,
        name: gift.category?.name ?? "Outros presentes",
        emoji: gift.category?.emoji ?? "🎁",
        position: gift.category?.position ?? Number.MAX_SAFE_INTEGER,
        gifts: [],
      };
      current.gifts.push(gift);
      groups.set(key, current);
      return groups;
    }, new Map<string, { id: string; name: string; emoji: string; position: number; gifts: typeof gifts }>()),
  ).map(([, group]) => group).sort((left, right) => left.position - right.position);

  return (
    <main
      className={styles.page}
      data-preset={event.theme.preset.toLowerCase()}
      data-accent={event.theme.accent.toLowerCase()}
    >
      <header className={`${styles.hero} ${event.theme.cover === "NONE" ? styles.heroWithoutCover : ""}`}>
        {cover.image ? <Image
          src={cover.image}
          alt={cover.alt}
          fill
          priority
          sizes="100vw"
        /> : null}
        <div className={styles.heroShade} />
        <div className={styles.theme}><ThemeToggle /></div>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>{event.theme.welcomeTitle || "Você é nosso convidado"}</p>
          <h1>{event.title}</h1>
          <p className={styles.greeting}>Olá, {guest.name}.</p>
        </div>
      </header>

      <section className={styles.details} aria-label="Detalhes do evento">
        <div><CalendarDays aria-hidden="true" /><span>{formatDate(event.startsAt, event.timeZone)}</span></div>
        {(event.venueName || event.venueAddress) && (
          <div><MapPin aria-hidden="true" /><span>{[event.venueName, event.venueAddress].filter(Boolean).join(" · ")}</span></div>
        )}
      </section>

      {event.description && <p className={styles.description}>{event.description}</p>}

      <section className={styles.rsvp} aria-labelledby="rsvp-title">
        <div className={styles.sectionHeading}>
          <UserRoundCheck aria-hidden="true" />
          <div>
            <h2 id="rsvp-title">Sua presença</h2>
            <p>Responda até {formatDate(event.confirmationDeadline, event.timeZone)}.</p>
          </div>
        </div>

        <fieldset className={styles.attendanceSelector} disabled={pendingAction === "rsvp" || !event.confirmationOpen}>
          <legend>Quantas pessoas irão?</legend>
          <p>Informe ao menos um adulto. A quantidade de crianças é opcional.</p>
          <div className={styles.attendanceGrid}>
            <div className={styles.attendanceRow}>
              <span><strong>Adultos</strong><small>Inclua você na contagem</small></span>
              <div className={styles.stepper}>
                <button type="button" aria-label="Remover adulto" disabled={adultCount === 0} onClick={() => { attendanceDirtyRef.current = true; setAdultCount((value) => Math.max(0, value - 1)); }}><Minus aria-hidden="true" /></button>
                <output aria-live="polite" aria-label={`${adultCount} adultos`}>{adultCount}</output>
                <button type="button" aria-label="Adicionar adulto" onClick={() => { attendanceDirtyRef.current = true; setAdultCount((value) => Math.min(999, value + 1)); }}><Plus aria-hidden="true" /></button>
              </div>
            </div>
            <div className={styles.attendanceRow}>
              <span><strong>Crianças</strong><small>Informe somente quem comparecerá</small></span>
              <div className={styles.stepper}>
                <button type="button" aria-label="Remover criança" disabled={childCount === 0} onClick={() => { attendanceDirtyRef.current = true; setChildCount((value) => Math.max(0, value - 1)); }}><Minus aria-hidden="true" /></button>
                <output aria-live="polite" aria-label={`${childCount} crianças`}>{childCount}</output>
                <button type="button" aria-label="Adicionar criança" onClick={() => { attendanceDirtyRef.current = true; setChildCount((value) => Math.min(999, value + 1)); }}><Plus aria-hidden="true" /></button>
              </div>
            </div>
          </div>
        </fieldset>

        <p className={styles.rsvpStatus} aria-live="polite">
          {guest.rsvpStatus === "CONFIRMED" && (
            <><Check aria-hidden="true" /> Presença confirmada para {guest.adultCount + guest.childCount} pessoa(s): {guest.adultCount} adulto(s) e {guest.childCount} criança(s).</>
          )}
          {guest.rsvpStatus === "DECLINED" && (
            <><X aria-hidden="true" /> Sua presença está desconfirmada.</>
          )}
          {guest.rsvpStatus === "PENDING" && "Você ainda não respondeu ao convite."}
        </p>

        <div className={styles.rsvpActions}>
          <button type="button" aria-pressed={guest.rsvpStatus === "CONFIRMED"} className={`${styles.primaryButton} ${confirmationSaved ? styles.confirmedButton : ""}`} disabled={!event.confirmationOpen || pendingAction === "rsvp" || confirmationSaved} onClick={() => void confirm("CONFIRMED")}>
            {pendingAction === "rsvp" ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : <Check aria-hidden="true" />}
            {confirmationSaved ? "Presença confirmada" : guest.rsvpStatus === "CONFIRMED" ? "Atualizar confirmação" : "Confirmar presença"}
          </button>
          <button type="button" aria-pressed={guest.rsvpStatus === "DECLINED"} className={`${styles.secondaryButton} ${guest.rsvpStatus === "DECLINED" ? styles.declinedButton : ""}`} disabled={!event.confirmationOpen || pendingAction === "rsvp"} onClick={() => void confirm("DECLINED")}>
            <X aria-hidden="true" /> {guest.rsvpStatus === "DECLINED" ? "Presença desconfirmada" : "Desconfirmar presença"}
          </button>
        </div>
        {!event.confirmationOpen && <p className={styles.closed}>O prazo de confirmação foi encerrado.</p>}
      </section>

      {gifts.length > 0 && (
        <section className={styles.giftSection} aria-labelledby="gift-title">
          <div className={styles.sectionHeading}>
            <Gift aria-hidden="true" />
            <div><h2 id="gift-title">Lista de presentes</h2><p>Escolha um item. A lista é atualizada automaticamente.</p></div>
          </div>
          <div className={styles.giftGroups}>
            {giftGroups.map((group) => (
              <section key={group.id} className={styles.giftGroup} aria-labelledby={`gift-category-${group.id}`}>
                <div className={styles.giftCategoryHeading}>
                  <span aria-hidden="true">{group.emoji}</span>
                  <h3 id={`gift-category-${group.id}`}>{group.name}</h3>
                  <small>{group.gifts.length}</small>
                </div>
                <div className={styles.giftGrid}>
                  {group.gifts.map((gift) => {
                    const url = safeExternalUrl(gift.externalUrl);
                    return (
                      <article key={gift.id} className={`${styles.giftItem} ${gift.reserved ? styles.reserved : ""}`}>
                        <span className={styles.giftEmoji} aria-hidden="true">{gift.emoji}</span>
                        <div className={styles.giftCopy}>
                          <h4>{gift.title}</h4>
                          {gift.description && <p>{gift.description}</p>}
                          {gift.unlimited ? (
                            <p>∞ Disponível sem limite · {gift.reservedCount} escolha(s)</p>
                          ) : gift.quantity && gift.quantity > 1 ? (
                            <p>{gift.availableCount} de {gift.quantity} disponíveis</p>
                          ) : null}
                        </div>
                        <div className={styles.giftActions}>
                          {url && <a href={url} target="_blank" rel="noreferrer" aria-label={`Ver ${gift.title}`}><ExternalLink aria-hidden="true" /></a>}
                          <button type="button" disabled={(gift.reserved && !gift.reservedByMe) || pendingAction === gift.id} onClick={() => void toggleGift(gift.id, gift.reservedByMe)}>
                            {pendingAction === gift.id ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : gift.reservedByMe ? <X aria-hidden="true" /> : <Check aria-hidden="true" />}
                            {gift.reservedByMe ? "Liberar" : gift.reserved ? "Escolhido" : "Escolher"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}

      <div className={styles.feedback} aria-live="polite">
        {error && <p className={styles.error}>{error}</p>}
        {notice && <p className={styles.notice}>{notice}</p>}
      </div>
      <footer>PerfectUtilitares · convite privado</footer>
    </main>
  );
}
