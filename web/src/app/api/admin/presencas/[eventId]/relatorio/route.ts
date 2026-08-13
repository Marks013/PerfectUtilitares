import { jsonError, methodNotAllowed, requireAdmin } from "@/lib/api/security";
import { presenceAdminExportQuerySchema } from "@/lib/presence/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ eventId: string }> };

const responseLabel = {
  PENDING: "Aguardando",
  CONFIRMED: "Confirmado",
  DECLINED: "Não participará",
} as const;

const deliveryKindLabel = {
  INVITATION: "Convite",
  REMINDER: "Lembrete",
} as const;

const deliveryStatusLabel = {
  PENDING: "Preparado",
  SENDING: "Enviando",
  SENT: "Enviado",
  DELIVERED: "Entregue",
  DELAYED: "Entrega atrasada",
  BOUNCED: "Devolvido",
  COMPLAINED: "Marcado como spam",
  SUPPRESSED: "Suprimido",
  FAILED: "Falhou",
} as const;

const providerStatusLabel: Record<string, string> = {
  sent: "Enviado pelo provedor",
  delivered: "Entregue ao servidor de destino",
  delivery_delayed: "Entrega temporariamente atrasada",
  failed: "Falha no provedor",
  bounced: "Recusado pelo destinatário",
  complained: "Marcado como spam",
  suppressed: "Envio bloqueado pelo provedor",
  opened: "Aberto",
  clicked: "Link acessado",
};

function csvCell(value: string | number | null) {
  let text = value === null ? "" : String(value);
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const tenantId = guard.session.user.tenantId;
  if (!tenantId) {
    return jsonError(
      403,
      "ADMIN_TENANT_REQUIRED",
      "Vincule o administrador a uma empresa para exportar o evento.",
    );
  }

  const query = presenceAdminExportQuerySchema.safeParse({
    status: new URL(request.url).searchParams.get("status") ?? "ALL",
  });
  if (!query.success) {
    return jsonError(400, "VALIDATION_ERROR", "Filtro inválido.");
  }

  const { eventId } = await context.params;
  const event = await prisma.presenceEvent.findFirst({
    where: { id: eventId, tenantId },
    select: {
      eventSlug: true,
      guests: {
        where:
          query.data.status === "ALL"
            ? undefined
            : { rsvpStatus: query.data.status },
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
        take: 10_000,
        select: {
          name: true,
          email: true,
          rsvpStatus: true,
          adultCount: true,
          childCount: true,
          respondedAt: true,
          reservedGifts: {
            orderBy: { position: "asc" },
            select: { title: true },
          },
          deliveries: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              kind: true,
              status: true,
              providerStatus: true,
              sentAt: true,
              deliveredAt: true,
            },
          },
        },
      },
    },
  });
  if (!event) {
    return jsonError(404, "EVENT_NOT_FOUND", "Evento não encontrado.");
  }

  const rows = [
    [
      "Nome",
      "E-mail",
      "Resposta",
      "Adultos",
      "Crianças",
      "Total de pessoas",
      "Data da resposta",
      "Presentes",
      "Tipo do último envio",
      "Situação do último envio",
      "Retorno do provedor",
      "Enviado em",
      "Entregue em",
    ],
    ...event.guests.map((guest) => {
      const delivery = guest.deliveries[0];
      return [
        guest.name,
        guest.email,
        responseLabel[guest.rsvpStatus],
        guest.adultCount,
        guest.childCount,
        guest.adultCount + guest.childCount,
        guest.respondedAt?.toISOString() ?? null,
        guest.reservedGifts.map((gift) => gift.title).join(" | "),
        delivery ? deliveryKindLabel[delivery.kind] : null,
        delivery ? deliveryStatusLabel[delivery.status] : null,
        delivery?.providerStatus
          ? providerStatusLabel[delivery.providerStatus] ?? "Atualizado"
          : null,
        delivery?.sentAt?.toISOString() ?? null,
        delivery?.deliveredAt?.toISOString() ?? null,
      ];
    }),
  ];
  const csv = `\uFEFF${rows
    .map((row) => row.map((value) => csvCell(value)).join(";"))
    .join("\r\n")}`;

  return new Response(csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="presencas-${event.eventSlug}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function POST() {
  return methodNotAllowed(["GET"]);
}

export function PATCH() {
  return methodNotAllowed(["GET"]);
}

export function DELETE() {
  return methodNotAllowed(["GET"]);
}
