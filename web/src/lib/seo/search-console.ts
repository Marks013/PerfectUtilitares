import { createSign } from "node:crypto";
import { getSiteUrl } from "@/lib/seo";

type SearchRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

type SearchAnalyticsResponse = { rows?: SearchRow[] };

export type SearchConsoleSnapshot = {
  configured: boolean;
  property: string;
  error?: string;
  current?: SearchRow;
  previous?: SearchRow;
  queries: SearchRow[];
  pages: SearchRow[];
  indexing: Array<{
    url: string;
    verdict: string;
    coverage: string;
    lastCrawlTime?: string;
  }>;
  period?: { start: string; end: string };
};

const CACHE_TTL_MS = 15 * 60_000;
let cached: { expiresAt: number; value: SearchConsoleSnapshot } | null = null;
let tokenCache: { expiresAt: number; token: string } | null = null;

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function readCredentials() {
  const email = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  return email && privateKey ? { email, privateKey } : null;
}

async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const credentials = readCredentials();
  if (!credentials) throw new Error("Credenciais do Search Console não configuradas.");

  const now = Math.floor(Date.now() / 1_000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: credentials.email,
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3_600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64Url(signer.sign(credentials.privateKey))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("O Search Console recusou as credenciais configuradas.");

  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("O Search Console não retornou um token de acesso.");
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, (payload.expires_in ?? 3_600) - 120) * 1_000,
  };
  return payload.access_token;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function querySearchAnalytics(
  token: string,
  property: string,
  startDate: string,
  endDate: string,
  dimensions: string[] = [],
) {
  const response = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit: dimensions.length ? 10 : 1 }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error("Não foi possível consultar os dados de pesquisa da propriedade.");
  return (await response.json()) as SearchAnalyticsResponse;
}

async function inspectUrl(token: string, property: string, url: string) {
  const response = await fetch(
    "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: property, languageCode: "pt-BR" }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    return { url, verdict: "INDEFINIDO", coverage: "Inspeção indisponível" };
  }
  const payload = (await response.json()) as {
    inspectionResult?: {
      indexStatusResult?: {
        verdict?: string;
        coverageState?: string;
        lastCrawlTime?: string;
      };
    };
  };
  const result = payload.inspectionResult?.indexStatusResult;
  return {
    url,
    verdict: result?.verdict ?? "INDEFINIDO",
    coverage: result?.coverageState ?? "Sem informação",
    lastCrawlTime: result?.lastCrawlTime,
  };
}

export async function getSearchConsoleSnapshot(): Promise<SearchConsoleSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const property = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL?.trim() || getSiteUrl().toString();
  if (!readCredentials()) return { configured: false, property, queries: [], pages: [], indexing: [] };

  try {
    const token = await getAccessToken();
    const end = new Date(Date.now() - 3 * 86_400_000);
    const currentStart = new Date(end.getTime() - 27 * 86_400_000);
    const previousEnd = new Date(currentStart.getTime() - 86_400_000);
    const previousStart = new Date(previousEnd.getTime() - 27 * 86_400_000);
    const period = { start: formatDate(currentStart), end: formatDate(end) };

    const [current, previous, queries, pages] = await Promise.all([
      querySearchAnalytics(token, property, period.start, period.end),
      querySearchAnalytics(token, property, formatDate(previousStart), formatDate(previousEnd)),
      querySearchAnalytics(token, property, period.start, period.end, ["query"]),
      querySearchAnalytics(token, property, period.start, period.end, ["page"]),
    ]);

    const base = getSiteUrl();
    const inspectionUrls = [
      "/dashboard",
      "/jornada/validar",
      "/fotos",
      "/pdf",
      "/pdf/comprimir",
    ].map((path) => new URL(path, base).toString());
    const indexing = await Promise.all(
      inspectionUrls.map((url) => inspectUrl(token, property, url)),
    );

    const value: SearchConsoleSnapshot = {
      configured: true,
      property,
      current: current.rows?.[0],
      previous: previous.rows?.[0],
      queries: queries.rows ?? [],
      pages: pages.rows ?? [],
      indexing,
      period,
    };
    cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (error) {
    return {
      configured: true,
      property,
      queries: [],
      pages: [],
      indexing: [],
      error: error instanceof Error ? error.message : "Falha ao consultar o Search Console.",
    };
  }
}
