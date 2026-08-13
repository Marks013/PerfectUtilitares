import { Activity, BarChart3, Gauge, SearchCheck } from "lucide-react";
import type { SearchConsoleSnapshot } from "@/lib/seo/search-console";
import type { VitalSummary } from "@/lib/seo/web-vitals";

type WebVitalsSnapshot = {
  days: number;
  metrics: VitalSummary[];
  totalSamples: number;
  routes: Array<{ path: string; count: number }>;
};

const METRIC_LABELS: Record<string, string> = {
  LCP: "Carregamento principal",
  INP: "Resposta às interações",
  CLS: "Estabilidade visual",
  FCP: "Primeiro conteúdo",
  TTFB: "Resposta do servidor",
};

const RATING_LABELS = {
  good: "Bom",
  "needs-improvement": "Pode melhorar",
  poor: "Ruim",
  pending: "Aguardando dados",
};

function formatVital(metric: string, value: number | null) {
  if (value === null) return "—";
  if (metric === "CLS") return value.toFixed(3).replace(".", ",");
  return `${Math.round(value).toLocaleString("pt-BR")} ms`;
}

function formatNumber(value = 0) {
  return Math.round(value).toLocaleString("pt-BR");
}

function formatPercent(value = 0) {
  return value.toLocaleString("pt-BR", { style: "percent", maximumFractionDigits: 1 });
}

function formatPosition(value = 0) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function indexLabel(verdict: string) {
  if (verdict === "PASS") return "Indexada";
  if (verdict === "FAIL") return "Não indexada";
  if (verdict === "NEUTRAL") return "Em avaliação";
  return "Sem confirmação";
}

export function SeoMonitoringDashboard({
  search,
  vitals,
}: {
  search: SearchConsoleSnapshot;
  vitals: WebVitalsSnapshot;
}) {
  const summary = search.current;

  return (
    <div className="space-y-7">
      <header>
        <p className="app-kicker">Visibilidade e experiência</p>
        <h1 className="mt-2 text-2xl font-black text-[color:var(--app-fg)] sm:text-3xl">
          Desempenho no Google
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--app-muted)]">
          Acompanhe como as páginas aparecem nas pesquisas e como elas se comportam
          nos dispositivos reais dos visitantes.
        </p>
      </header>

      {!search.configured ? (
        <section className="app-panel p-5">
          <SearchCheck className="size-5 text-[color:var(--app-gold)]" aria-hidden="true" />
          <h2 className="mt-3 text-base font-extrabold text-[color:var(--app-fg)]">
            Search Console aguardando conexão
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--app-muted)]">
            Verifique o domínio no Google Search Console e autorize a conta de
            leitura do PerfectUtilitares. Depois disso, consultas, cliques, CTR,
            posição e indexação serão atualizados aqui automaticamente.
          </p>
        </section>
      ) : search.error ? (
        <section className="app-panel border-[color:var(--app-warning-border)] p-5">
          <h2 className="text-base font-extrabold text-[color:var(--app-fg)]">
            Search Console temporariamente indisponível
          </h2>
          <p className="mt-2 text-sm text-[color:var(--app-muted)]">{search.error}</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="search-summary-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="search-summary-title" className="text-base font-extrabold text-[color:var(--app-fg)]">
                Pesquisa orgânica
              </h2>
              {search.period ? (
                <p className="text-xs text-[color:var(--app-muted)]">
                  {search.period.start.split("-").reverse().join("/")} a{" "}
                  {search.period.end.split("-").reverse().join("/")}
                </p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Cliques", formatNumber(summary?.clicks), BarChart3],
                ["Impressões", formatNumber(summary?.impressions), SearchCheck],
                ["CTR médio", formatPercent(summary?.ctr), Gauge],
                ["Posição média", formatPosition(summary?.position), Activity],
              ].map(([label, value, Icon]) => (
                <article key={String(label)} className="app-panel p-4">
                  <Icon className="size-4 text-[color:var(--app-teal)]" aria-hidden="true" />
                  <p className="mt-3 text-xs font-semibold text-[color:var(--app-muted)]">{String(label)}</p>
                  <p className="mt-1 text-2xl font-black text-[color:var(--app-fg)]">{String(value)}</p>
                </article>
              ))}
            </div>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <SearchTable title="Consultas mais frequentes" rows={search.queries} kind="query" />
            <SearchTable title="Páginas com mais impressões" rows={search.pages} kind="page" />
          </div>

          <section className="app-panel overflow-hidden">
            <div className="border-b border-[color:var(--app-border)] p-4">
              <h2 className="text-base font-extrabold text-[color:var(--app-fg)]">Indexação principal</h2>
            </div>
            <div className="divide-y divide-[color:var(--app-border)]">
              {search.indexing.map((item) => (
                <div key={item.url} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[color:var(--app-fg)]">
                      {new URL(item.url).pathname}
                    </p>
                    <p className="mt-1 text-xs text-[color:var(--app-muted)]">{item.coverage}</p>
                  </div>
                  <span className="app-badge">{indexLabel(item.verdict)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section aria-labelledby="vitals-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="vitals-title" className="text-base font-extrabold text-[color:var(--app-fg)]">
              Core Web Vitals e velocidade
            </h2>
            <p className="mt-1 text-xs text-[color:var(--app-muted)]">
              Percentil 75 dos últimos {vitals.days} dias · {formatNumber(vitals.totalSamples)} amostras
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {vitals.metrics.map((metric) => (
            <article key={metric.metric} className="app-panel p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-[color:var(--app-teal)]">{metric.metric}</span>
                <span className={`vital-rating vital-rating-${metric.rating}`}>
                  {RATING_LABELS[metric.rating]}
                </span>
              </div>
              <p className="mt-3 text-xl font-black text-[color:var(--app-fg)]">
                {formatVital(metric.metric, metric.p75)}
              </p>
              <p className="mt-1 text-xs leading-5 text-[color:var(--app-muted)]">
                {METRIC_LABELS[metric.metric] ?? metric.metric} · {metric.samples} amostras
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SearchTable({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: SearchConsoleSnapshot["queries"];
  kind: "query" | "page";
}) {
  return (
    <section className="app-panel overflow-hidden">
      <h2 className="border-b border-[color:var(--app-border)] p-4 text-base font-extrabold text-[color:var(--app-fg)]">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-[color:var(--app-muted)]">Ainda não há dados neste período.</p>
      ) : (
        <div className="divide-y divide-[color:var(--app-border)]">
          {rows.map((row) => {
            const rawLabel = row.keys?.[0] ?? "Sem identificação";
            const label = kind === "page" ? new URL(rawLabel).pathname : rawLabel;
            return (
              <div key={rawLabel} className="grid grid-cols-[1fr_auto] gap-3 p-4">
                <p className="min-w-0 truncate text-sm font-semibold text-[color:var(--app-fg)]">{label}</p>
                <p className="text-right text-xs text-[color:var(--app-muted)]">
                  {formatNumber(row.clicks)} cliques · {formatNumber(row.impressions)} impressões
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
