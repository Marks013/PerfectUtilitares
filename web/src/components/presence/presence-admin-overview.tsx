import { Download, Gift, MailCheck, Users } from "lucide-react";
import type { PresenceEventDetail } from "./presence-admin-model";

const metricClass =
  "min-w-0 border-l-2 border-[color:var(--app-action-blue)] px-3 py-1";

export function PresenceAdminOverview({
  detail,
}: {
  detail: PresenceEventDetail;
}) {
  const { analytics } = detail;
  const deliveryTotal = Object.values(analytics.deliveries).reduce(
    (total, value) => total + (value ?? 0),
    0,
  );
  const delivered = analytics.deliveries.DELIVERED ?? 0;

  return (
    <div className="mt-5 border-y border-[color:var(--app-border)] py-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={metricClass}>
          <p className="text-xs text-[color:var(--app-muted)]">Confirmados</p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {analytics.rsvp.CONFIRMED}
          </p>
        </div>
        <div className={metricClass}>
          <p className="text-xs text-[color:var(--app-muted)]">Pessoas esperadas</p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {analytics.rsvp.expectedAttendance}
          </p>
        </div>
        <div className={metricClass}>
          <p className="text-xs text-[color:var(--app-muted)]">Presentes escolhidos</p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {analytics.gifts.reserved}/{analytics.gifts.active}
          </p>
        </div>
        <div className={metricClass}>
          <p className="text-xs text-[color:var(--app-muted)]">E-mails entregues</p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {delivered}/{deliveryTotal}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <Users className="size-4" aria-hidden="true" /> Respostas recebidas
            </span>
            <span className="tabular-nums">{analytics.responseRate}%</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--app-surface)]"
            role="progressbar"
            aria-label="Respostas recebidas"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={analytics.responseRate}
          >
            <div
              className="h-full rounded-full bg-[color:var(--app-action-green)] transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${analytics.responseRate}%` }}
            />
          </div>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--app-muted)]">
            <span className="inline-flex items-center gap-1"><MailCheck className="size-3.5" /> {analytics.rsvp.PENDING} aguardando</span>
            <span className="inline-flex items-center gap-1"><Gift className="size-3.5" /> {analytics.rsvp.DECLINED} não participarão</span>
          </p>
        </div>
        <a
          href={`/api/admin/presencas/${detail.id}/relatorio?status=ALL`}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-3 text-sm font-semibold hover:border-[color:var(--app-action-blue)]"
        >
          <Download className="size-4" aria-hidden="true" /> Exportar lista
        </a>
      </div>
    </div>
  );
}
