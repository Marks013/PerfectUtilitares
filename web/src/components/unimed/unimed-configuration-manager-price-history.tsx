"use client";

import { CalendarDays, History } from "lucide-react";
import { useState } from "react";
import type { useUnimedConfigurationManagerController } from "./unimed-configuration-manager";

type Model = ReturnType<typeof useUnimedConfigurationManagerController>;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" });
const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00.000Z`));
}

function formatCurrency(value: string) {
  return currencyFormatter.format(Number(value));
}

export function UnimedConfigurationPriceHistory({ model }: { model: Model }) {
  const { ConfigSection, priceHistory } = model;
  const [selectedPeriod, setSelectedPeriod] = useState(0);

  const activePeriodIndex = priceHistory[selectedPeriod] ? selectedPeriod : 0;
  const period = priceHistory[activePeriodIndex];

  return (
    <ConfigSection
      id="config-price-history-section"
      icon={History}
      title="Competências de preços"
      description="Consulte a tabela ativa e a competência imediatamente anterior."
      defaultOpen
    >
      {period ? (
        <>
          <fieldset
            className="flex flex-wrap gap-2"
            aria-label="Competência exibida"
          >
            {priceHistory.map((item, index) => (
              <button
                key={`${item.status}-${item.validFrom}`}
                type="button"
                aria-pressed={activePeriodIndex === index}
                onClick={() => setSelectedPeriod(index)}
                className={`min-h-11 rounded-xl border px-4 py-2 text-left transition ${
                  activePeriodIndex === index
                    ? "border-[color:var(--app-teal)] bg-[color:var(--app-teal-soft)] text-[color:var(--app-fg)]"
                    : "border-[color:var(--app-border)] bg-[color:var(--app-surface)] text-[color:var(--app-muted)] hover:border-[color:var(--app-border-strong)]"
                }`}
              >
                <span className="block text-sm font-black">
                  {item.status === "ACTIVE" ? "Ativa" : "Anterior"}
                </span>
                <span className="block text-xs">{formatDate(item.validFrom)}</span>
              </button>
            ))}
          </fieldset>

          <div className="mt-5 flex flex-col gap-3 border-y border-[color:var(--app-border)] py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black text-[color:var(--app-teal)] uppercase">
                {period.status === "ACTIVE" ? "Tabela ativa" : "Tabela anterior"}
              </p>
              <p className="mt-1 text-lg font-black text-[color:var(--app-fg)]">
                Competência {formatDate(period.validFrom)}
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--app-muted)]">
              <CalendarDays className="size-4" aria-hidden="true" />
              {formatDate(period.validFrom)} a {period.validTo ? formatDate(period.validTo) : "sem término"}
            </div>
          </div>

          <div className="mt-5">
            <h3 className="text-sm font-black text-[color:var(--app-fg)]">
              Valores por faixa etária
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--app-border-strong)] text-xs text-[color:var(--app-muted)] uppercase">
                    <th className="px-3 py-3 font-black">Faixa</th>
                    <th className="px-3 py-3 font-black">Idade</th>
                    <th className="px-3 py-3 text-right font-black">Valor fatura</th>
                    <th className="px-3 py-3 text-right font-black">Valor titular</th>
                  </tr>
                </thead>
                <tbody>
                  {period.planPrices.map((price) => (
                    <tr
                      key={`${price.planCode}-${price.ageBracketCode}`}
                      className="border-b border-[color:var(--app-border)] last:border-0"
                    >
                      <td className="px-3 py-3 font-bold text-[color:var(--app-fg)]">
                        {price.ageBracketLabel || price.ageBracketCode}
                      </td>
                      <td className="px-3 py-3 text-[color:var(--app-muted)]">
                        {price.maxAge == null
                          ? `${price.minAge} anos ou mais`
                          : `${price.minAge} a ${price.maxAge} anos`}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-[color:var(--app-fg)]">
                        {formatCurrency(price.companyAmount)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-[color:var(--app-fg)]">
                        {formatCurrency(price.employeeAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 border-t border-[color:var(--app-border)] pt-5">
            <h3 className="text-sm font-black text-[color:var(--app-fg)]">
              Acessórios e adicionais
            </h3>
            {period.addonPrices.length > 0 ? (
              <div className="mt-3 divide-y divide-[color:var(--app-border)]">
                {period.addonPrices.map((addon) => (
                  <div
                    key={addon.code}
                    className="flex min-h-12 items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="font-bold text-[color:var(--app-fg)]">
                        {addon.label}
                      </p>
                      <p className="text-xs text-[color:var(--app-muted)]">
                        Código {addon.code}
                      </p>
                    </div>
                    <p className="shrink-0 font-black text-[color:var(--app-fg)]">
                      {formatCurrency(addon.amount)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-[color:var(--app-muted)]">
                Nenhum adicional nesta competência.
              </p>
            )}
          </div>

          {priceHistory.length === 1 ? (
            <p className="mt-5 border-t border-[color:var(--app-border)] pt-4 text-xs leading-5 text-[color:var(--app-muted)]">
              A competência anterior aparecerá aqui depois do próximo cadastro.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-[color:var(--app-muted)]">
          Nenhuma tabela de preços cadastrada.
        </p>
      )}
    </ConfigSection>
  );
}
