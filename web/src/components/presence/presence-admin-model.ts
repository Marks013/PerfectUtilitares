export type PresenceStatus = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
export type RsvpStatus = "PENDING" | "CONFIRMED" | "DECLINED";
export type PresenceDeliveryStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "DELIVERED"
  | "DELAYED"
  | "BOUNCED"
  | "COMPLAINED"
  | "SUPPRESSED"
  | "FAILED";

export type PresenceTheme = {
  preset: "CELEBRATION" | "ELEGANT" | "GARDEN" | "NIGHT";
  cover:
    | "EVENT_TABLE"
    | "WEDDING"
    | "BIRTHDAY"
    | "KITCHEN_TEA"
    | "BABY_SHOWER"
    | "NONE";
  accent: "CORAL" | "BLUE" | "GREEN" | "GOLD";
  welcomeTitle: string | null;
};

type PresenceDeliveryAdmin = {
  id: string;
  kind: "INVITATION" | "REMINDER";
  status: PresenceDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  sentAt: string | null;
  providerStatus: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  complainedAt: string | null;
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
  adultCount: number;
  childCount: number;
  accessExpiresAt: string | null;
  tokenRevokedAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  deliveries: PresenceDeliveryAdmin[];
  _count: { reservedGifts: number };
};

export type PresenceGiftAdmin = {
  id: string;
  categoryId: string | null;
  emoji: string;
  title: string;
  description: string | null;
  externalUrl: string | null;
  position: number;
  active: boolean;
  quantity: number | null;
  reservedCount: number;
  availableCount: number | null;
  reservedManually: boolean;
  reservedAt: string | null;
  reservedByGuest: { id: string; name: string } | null;
};

type PresenceGiftCategoryAdmin = {
  id: string;
  name: string;
  emoji: string;
  position: number;
  _count: { gifts: number };
};

export type PresenceEventDetail = PresenceEventSummary & {
  description: string | null;
  venueName: string | null;
  venueAddress: string | null;
  timeZone: string;
  theme: PresenceTheme;
  reminderAt: string | null;
  reminderProcessedAt: string | null;
  retentionUntil: string | null;
  createdAt: string;
  updatedAt: string;
  guests: PresenceGuestAdmin[];
  giftCategories: PresenceGiftCategoryAdmin[];
  gifts: PresenceGiftAdmin[];
  _count: { guests: number; gifts: number; deliveries: number };
  analytics: {
    rsvp: {
      PENDING: number;
      CONFIRMED: number;
      DECLINED: number;
      expectedAttendance: number;
      adultsExpected: number;
      childrenExpected: number;
    };
    responseRate: number;
    gifts: { active: number; reserved: number };
    deliveries: Partial<Record<PresenceDeliveryStatus, number>>;
  };
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
  DELIVERED: "Entregue",
  DELAYED: "Entrega atrasada",
  BOUNCED: "Devolvido",
  COMPLAINED: "Marcado como spam",
  SUPPRESSED: "Suprimido",
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
