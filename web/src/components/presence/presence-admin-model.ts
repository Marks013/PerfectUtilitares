export type PresenceStatus = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
export type RsvpStatus = "PENDING" | "CONFIRMED" | "DECLINED";
export type PresenceDeliveryStatus = "PENDING" | "SENDING" | "SENT" | "FAILED";

type PresenceDeliveryAdmin = {
  id: string;
  status: PresenceDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

export type PresenceEventSummary = {
  id: string;
  eventSlug: string;
  title: string;
  startsAt: string;
  confirmationDeadline: string;
  status: PresenceStatus;
  publicRevision: number;
  _count: { guests: number; gifts: number };
};

type PresenceGuestAdmin = {
  id: string;
  name: string;
  email: string | null;
  guestSlug: string;
  rsvpStatus: RsvpStatus;
  companionLimit: number;
  companionCount: number;
  accessExpiresAt: string | null;
  tokenRevokedAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  deliveries: PresenceDeliveryAdmin[];
  _count: { reservedGifts: number };
};

export type PresenceGiftAdmin = {
  id: string;
  title: string;
  description: string | null;
  externalUrl: string | null;
  position: number;
  active: boolean;
  reservedAt: string | null;
  reservedByGuest: { id: string; name: string } | null;
};

export type PresenceEventDetail = PresenceEventSummary & {
  description: string | null;
  venueName: string | null;
  venueAddress: string | null;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
  guests: PresenceGuestAdmin[];
  gifts: PresenceGiftAdmin[];
  _count: { guests: number; gifts: number; deliveries: number };
};

export const statusLabel: Record<PresenceStatus, string> = {
  DRAFT: "Rascunho",
  PUBLISHED: "Publicado",
  CLOSED: "Encerrado",
  ARCHIVED: "Arquivado",
};

export const rsvpLabel: Record<RsvpStatus, string> = {
  PENDING: "Aguardando",
  CONFIRMED: "Confirmado",
  DECLINED: "Não participará",
};

export const deliveryLabel: Record<PresenceDeliveryStatus, string> = {
  PENDING: "Preparado",
  SENDING: "Enviando",
  SENT: "Enviado",
  FAILED: "Falhou",
};

export function slugifyPresence(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function presenceApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } | string } | null;
    throw new Error(typeof payload?.error === "string" ? payload.error : payload?.error?.message ?? "Não foi possível concluir a operação.");
  }
  return (await response.json()) as T;
}

export function localDateInput(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}
