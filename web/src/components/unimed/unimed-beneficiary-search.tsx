"use client";

import { Check, Loader2, Search, UserRound, X } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type UnimedResolvedPricing = {
  status:
    | "RESOLVED"
    | "MISSING_BIRTH_DATE"
    | "MISSING_PLAN_CODE"
    | "MISSING_AGE_BRACKET"
    | "MISSING_PRICE";
  age: number | null;
  ageBracketCode: string | null;
  planCode: string | null;
  companyAmount: string | null;
  employeeAmount: string | null;
};

export type UnimedPricingContext = {
  referenceDate: string;
  dataCompetency?: { year: number; month: number } | null;
  billingClosure: "OPEN" | "AUTOMATIC_DAY_25" | null;
  addonPrices: Array<{ code: string; label: string; amount: string }>;
};

export type UnimedBeneficiary = {
  id: string;
  registration: string | null;
  fullName: string;
  cpf: string | null;
  birthDate: string | null;
  inclusionDate: string | null;
  category: string | null;
  relationship: string | null;
  planCode: string | null;
  planName: string | null;
  accommodation: string | null;
  hasAddon: boolean;
  branch: { code: string; name: string } | null;
  pricing: UnimedResolvedPricing;
  dependents: Array<{
    id: string;
    fullName: string;
    birthDate: string | null;
    category: "DEPENDENT";
    relationship: string | null;
    planCode: string | null;
    planName: string | null;
    hasAddon: boolean;
    pricing: UnimedResolvedPricing;
  }>;
};

type ApiErrorBody = {
  error?: string | { message?: string };
  details?: Array<{ message?: string }>;
};

type BeneficiarySearchMode = "NAME" | "CPF" | "REGISTRATION";

function detectedSearchMode(query: string): BeneficiarySearchMode | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  const numericQuery = /^[\d.()\-/\s]+$/.test(trimmed);
  if (numericQuery && digits.length === 11) return "CPF";
  if (numericQuery && digits.length > 0) return "REGISTRATION";
  return "NAME";
}

function searchModeLabel(mode: BeneficiarySearchMode | null) {
  if (mode === "CPF") return "CPF exato";
  if (mode === "REGISTRATION") return "matrícula exata";
  if (mode === "NAME") return "nome";
  return null;
}

async function readSearchError(response: Response) {
  try {
    const body = (await response.json()) as ApiErrorBody;
    const detail = body.details?.find((item) => item.message)?.message;
    if (detail) return detail;
    if (typeof body.error === "string") return body.error;
    if (body.error?.message) return body.error.message;
  } catch {
    // Resposta sem JSON: usa mensagem segura abaixo.
  }

  return "Não foi possível pesquisar beneficiários. Tente novamente.";
}

function formatCpfForDisplay(value: string | null) {
  if (!value) return "CPF não informado";
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length !== 11) return value;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function UnimedBeneficiarySearch({
  selected,
  referenceDate,
  onSelect,
  onClear,
}: {
  selected: UnimedBeneficiary | null;
  referenceDate?: string;
  onSelect: (
    beneficiary: UnimedBeneficiary,
    context: UnimedPricingContext,
  ) => void;
  onClear: () => void;
}) {
  const listId = useId();
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UnimedBeneficiary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [pricingContext, setPricingContext] =
    useState<UnimedPricingContext | null>(null);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const queryMode = detectedSearchMode(query);

  const search = useCallback(
    async (requestedQuery = query) => {
      const normalizedQuery = requestedQuery.trim();
      if (normalizedQuery.length < 2) return;

      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      const sequence = ++requestSequence.current;
      setIsSearching(true);
      setError(null);
      setHasSearched(true);

      try {
        const dateQuery = referenceDate
          ? `&referenceDate=${encodeURIComponent(referenceDate)}`
          : "";
        const response = await fetch(
          `/api/unimed/beneficiaries?q=${encodeURIComponent(normalizedQuery)}${dateQuery}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error(await readSearchError(response));
        const body = (await response.json()) as {
          searchMode?: BeneficiarySearchMode;
          beneficiaries?: UnimedBeneficiary[];
          pricingContext?: UnimedPricingContext;
        };
        if (sequence === requestSequence.current) {
          setResults(
            Array.isArray(body.beneficiaries) ? body.beneficiaries : [],
          );
          setPricingContext(body.pricingContext ?? null);
        }
      } catch (searchError) {
        if (controller.signal.aborted || sequence !== requestSequence.current) {
          return;
        }
        setResults([]);
        setPricingContext(null);
        setError(
          searchError instanceof Error
            ? searchError.message
            : "Não foi possível pesquisar beneficiários.",
        );
      } finally {
        if (sequence === requestSequence.current) setIsSearching(false);
      }
    },
    [query, referenceDate],
  );

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      requestSequence.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      setResults([]);
      setPricingContext(null);
      setError(null);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    const timer = window.setTimeout(() => void search(normalizedQuery), 350);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  useEffect(
    () => () => {
      requestController.current?.abort();
    },
    [],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void search(query);
  }

  return (
    <div className="rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-4 sm:p-5">
      <label
        htmlFor={`${listId}-query`}
        className="block text-sm font-black text-[color:var(--app-fg)]"
      >
        Pesquisar beneficiário
      </label>
      <p className="mt-1 text-xs leading-5 text-[color:var(--app-muted)]">
        A busca consulta primeiro a competência mais recente e, sem resultado, a
        imediatamente anterior. Use nome, CPF ou matrícula.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[color:var(--app-subtle)]"
            aria-hidden="true"
          />
          <input
            id={`${listId}-query`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nome, CPF ou matrícula"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-controls={results.length > 0 ? listId : undefined}
            aria-expanded={results.length > 0}
            aria-busy={isSearching}
            aria-describedby={statusId}
            className="min-h-11 w-full rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-input)] py-2.5 pr-3 pl-10 text-sm font-semibold text-[color:var(--app-fg)] transition focus:border-[color:var(--app-teal)]"
          />
        </div>
        <button
          type="button"
          onClick={() => void search(query)}
          disabled={query.trim().length < 2 || isSearching}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[color:var(--app-action-blue)] px-5 py-2.5 text-sm font-black text-[color:var(--app-action-text)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSearching ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4" aria-hidden="true" />
          )}
          Buscar agora
        </button>
      </div>
      {queryMode ? (
        <p className="mt-2 text-xs font-bold text-[color:var(--app-teal)]">
          Pesquisa identificada: {searchModeLabel(queryMode)}.
        </p>
      ) : null}

      <div
        id={statusId}
        className="mt-3"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {isSearching ? (
          <p className="sr-only">Pesquisando beneficiários.</p>
        ) : null}
        {error ? (
          <p
            className="rounded-xl border border-[color:var(--app-danger-border)] bg-[color:var(--app-danger-soft)] p-3 text-sm font-semibold text-[color:var(--app-fg)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {!error && hasSearched && !isSearching && results.length === 0 ? (
          <p className="text-sm text-[color:var(--app-muted)]">
            Nenhum beneficiário encontrado.
          </p>
        ) : null}
        {!error && hasSearched && !isSearching && results.length > 0 ? (
          <p className="sr-only">
            {results.length} resultado(s) encontrado(s). Use Tab para escolher.
          </p>
        ) : null}
      </div>

      {results.length > 0 ? (
        <ul
          id={listId}
          className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1"
          aria-label="Resultados da pesquisa"
        >
          {results.map((beneficiary) => {
            const isSelected = selected?.id === beneficiary.id;
            return (
              <li key={beneficiary.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (pricingContext) onSelect(beneficiary, pricingContext);
                  }}
                  disabled={!pricingContext}
                  aria-pressed={isSelected}
                  className={`flex min-h-14 w-full items-start gap-3 rounded-xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] ${
                    isSelected
                      ? "border-[color:var(--app-teal)] bg-[color:var(--app-success-soft)]"
                      : "border-[color:var(--app-border)] bg-[color:var(--app-card)] hover:border-[color:var(--app-teal)]"
                  }`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
                    {isSelected ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <UserRound className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-[color:var(--app-fg)]">
                      {beneficiary.fullName}
                    </span>
                    <span className="mt-1 block text-xs text-[color:var(--app-muted)]">
                      {formatCpfForDisplay(beneficiary.cpf)} · Matrícula{" "}
                      {beneficiary.registration || "não informada"}
                    </span>
                    <span className="mt-1 block text-xs text-[color:var(--app-fg)]">
                      {beneficiary.branch?.name || "Filial não informada"} ·{" "}
                      {beneficiary.planName || "Plano não informado"}
                    </span>
                    <span className="mt-1 block text-xs font-bold text-[color:var(--app-teal)]">
                      Titular
                      {beneficiary.dependents.length > 0
                        ? ` · ${beneficiary.dependents.length} dependente(s) vinculado(s)`
                        : ""}
                    </span>
                    {beneficiary.dependents.length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs text-[color:var(--app-muted)]">
                        {beneficiary.dependents.map((dependent) => (
                          <li key={dependent.id} className="break-words">
                            <span className="font-bold text-[color:var(--app-fg)]">
                              Dependente:
                            </span>{" "}
                            {dependent.fullName}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {selected ? (
        <div className="mt-4 rounded-xl border border-[color:var(--app-success-border)] bg-[color:var(--app-success-soft)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black tracking-wide text-[color:var(--app-teal)] uppercase">
                Titular selecionado
              </p>
              <p className="mt-1 text-sm font-black text-[color:var(--app-fg)]">
                {selected.fullName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-[color:var(--app-border)] text-[color:var(--app-muted)] transition hover:border-[color:var(--app-coral)] hover:text-[color:var(--app-coral)]"
              aria-label="Remover beneficiário selecionado"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          {pricingContext ? (
            <p className="mt-3 text-xs text-[color:var(--app-muted)]">
              {pricingContext.dataCompetency ? (
                <>
                  Base cadastral:{" "}
                  {String(pricingContext.dataCompetency.month).padStart(2, "0")}
                  /{pricingContext.dataCompetency.year}.{" "}
                </>
              ) : null}
              Valores calculados para{" "}
              {pricingContext.referenceDate.split("-").reverse().join("/")}.
            </p>
          ) : null}
          <p className="mt-2 text-xs font-bold text-[color:var(--app-fg)]">
            Acessório Funeral: titular {selected.hasAddon ? "sim" : "não"} ·{" "}
            dependentes{" "}
            {
              selected.dependents.filter((dependent) => dependent.hasAddon)
                .length
            }
            /{selected.dependents.length}
          </p>
        </div>
      ) : null}
    </div>
  );
}
