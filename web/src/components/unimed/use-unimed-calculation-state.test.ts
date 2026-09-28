import { beforeEach, describe, expect, it, vi } from "vitest";

const hookRuntime = vi.hoisted(() => {
  const slots: unknown[] = [];
  const cleanups: Array<() => void> = [];
  let cursor = 0;

  function nextSlot<T>(initial: T) {
    const index = cursor++;
    if (slots[index] === undefined) slots[index] = initial;
    return index;
  }

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      slots.length = 0;
      cleanups.length = 0;
      cursor = 0;
    },
    runCleanups() {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
    useState<T>(initial: T) {
      const index = nextSlot(initial);
      const setValue = (value: T | ((current: T) => T)) => {
        const current = slots[index] as T;
        slots[index] =
          typeof value === "function"
            ? (value as (current: T) => T)(current)
            : value;
      };
      return [slots[index] as T, setValue] as const;
    },
    useRef<T>(initial: T) {
      const index = nextSlot({ current: initial });
      return slots[index] as { current: T };
    },
    useEffect(effect: () => undefined | (() => void)) {
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    },
  };
});

vi.mock("react", () => ({
  useEffect: hookRuntime.useEffect,
  useId: () => "unimed-form-test",
  useMemo: <T>(factory: () => T) => factory(),
  useRef: hookRuntime.useRef,
  useState: hookRuntime.useState,
}));

import type { DependentValues } from "./unimed-calculation-types";
import { PAYROLL_LOANS_PRINT_STORAGE_KEY } from "./unimed-calculation-utils";
import { useUnimedCalculationState } from "./use-unimed-calculation-state";

const storage = new Map<string, string>();
const revokeObjectUrl = vi.fn();

function TestState() {
  hookRuntime.beginRender();
  return useUnimedCalculationState({});
}

function dependent(): DependentValues {
  return {
    id: "dependent-1",
    source: "MANUAL",
    selected: true,
    name: "Dependente",
    birthDate: null,
    inclusionDate: "2026-08-01",
    planCode: null,
    age: null,
    hasAddon: false,
    invoicePlanAmount: "120",
    addonAmount: "6,12",
  };
}

beforeEach(() => {
  hookRuntime.reset();
  storage.clear();
  revokeObjectUrl.mockReset();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  vi.stubGlobal("URL", { revokeObjectURL: revokeObjectUrl });
});

describe("useUnimedCalculationState", () => {
  it("keeps pending pricing and its result when only a dependent CPF changes", () => {
    let state = TestState();
    state.updateForm("dependents", [dependent()]);
    state = TestState();
    const abort = vi.fn();
    state.calculationAbortController.current = { abort } as unknown as AbortController;
    state.setIsCalculating(true);
    state.lastAutomaticCalculationFingerprint.current = "pending-pricing";
    state.updateDependent("dependent-1", "cpf", "111.444.777-35");
    state = TestState();
    expect(abort).not.toHaveBeenCalled();
    expect(state.isCalculating).toBe(true);
    expect(state.lastAutomaticCalculationFingerprint.current).toBe("pending-pricing");
    state.setResult({ invoiceRefund: "150.00" } as never);
    state.updateDependent("dependent-1", "cpf", "529.982.247-25");
    state = TestState();
    expect(state.result?.invoiceRefund).toBe("150.00");
    expect(state.form.dependents[0].cpf).toBe("529.982.247-25");
    state.updateDependent("dependent-1", "birthDate", "2011-01-01");
    state = TestState();
    expect(abort).toHaveBeenCalledOnce();
    expect(state.result).toBeNull();
  });
  it("clears selection and removed-dependent errors while preserving other pending fields", () => {
    let state = TestState();
    state.updateForm("dependents", [dependent(), { ...dependent(), id: "retained" }]);
    state.setErrors({
      dependents: "Selecione um dependente",
      "dependent-dependent-1": "Informe o nome",
      "dependent-retained": "Informe o nascimento",
      exclusionDate: "Informe a data",
    });
    state = TestState();
    state.updateForm("dependents", [state.form.dependents[1]]);
    state = TestState();
    expect(state.errors["dependent-dependent-1"]).toBeUndefined();
    expect(state.errors.dependents).toBeUndefined();
    expect(state.errors["dependent-retained"]).toBe("Informe o nascimento");
    expect(state.errors.exclusionDate).toBe("Informe a data");
    state.setErrors({ dependents: "Selecione um dependente" });
    state.setApiError("Erro anterior");
    state.updateDependent("retained", "selected", true);
    state = TestState();
    expect(state.errors.dependents).toBeUndefined();
    expect(state.apiError).toBeNull();
  });
  it("updates, normalizes and resets the calculation state", () => {
    storage.set(PAYROLL_LOANS_PRINT_STORAGE_KEY, "false");
    let state = TestState();
    state = TestState();
    expect(state.includePayrollLoans).toBe(false);

    state.updatePayrollLoansPrintPreference(true);
    expect(storage.get(PAYROLL_LOANS_PRINT_STORAGE_KEY)).toBe("true");

    state.setErrors({ employeeName: "Obrigatório" });
    state.setApiError("erro anterior");
    state.setSelectedBeneficiary({ id: "beneficiary-1" } as never);
    state.updateForm("employeeName", "Titular");
    state.updateForm("cpf", "12345678901");
    state.updateForm("reasonCode", "3");
    state.updateForm("exclusionDate", "2026-08-20");

    state = TestState();
    state.setForm((current) => ({
      ...current,
      holder: {
        invoicePlanAmount: "200",
        payrollPlanAmount: "61,26",
        addonAmount: "0",
      },
      dependents: [dependent()],
    }));
    state = TestState();

    state.updateHolder("invoicePlanAmount", "210");
    state.updateDependent("dependent-1", "name", "Nome alterado");
    state.blurMoney("payrollPlanAmount");
    state.blurDependentMoney(state.form.dependents[0], "invoicePlanAmount");

    state = TestState();
    expect(state.form.employeeName).toBe("Titular");
    expect(state.form.holder.invoicePlanAmount).toBe("210");
    expect(state.form.holder.payrollPlanAmount).toBe("61,26");
    expect(state.form.dependents[0]).toMatchObject({
      name: "Nome alterado",
      invoicePlanAmount: "120,00",
    });
    expect(state.apiError).toBeNull();

    state.resetWorkspace();
    state = TestState();
    expect(state.form.employeeName).toBe("");
    expect(state.form.dependents).toEqual([]);
  });

  it("aborts requests and revokes temporary document URLs", () => {
    const calculationAbort = vi.fn();
    const documentAbort = vi.fn();
    const state = TestState();
    state.calculationAbortController.current = {
      abort: calculationAbort,
    } as unknown as AbortController;
    state.documentAbortController.current = {
      abort: documentAbort,
    } as unknown as AbortController;
    state.generatedDocumentUrl.current = "blob:document";

    state.invalidateCalculation();
    state.invalidateDocument();

    expect(calculationAbort).toHaveBeenCalledOnce();
    expect(documentAbort).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:document");

    state.calculationAbortController.current = {
      abort: calculationAbort,
    } as unknown as AbortController;
    state.documentAbortController.current = {
      abort: documentAbort,
    } as unknown as AbortController;
    state.generatedDocumentUrl.current = "blob:on-unmount";
    hookRuntime.runCleanups();

    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:on-unmount");
    expect(calculationAbort).toHaveBeenCalledTimes(2);
    expect(documentAbort).toHaveBeenCalledTimes(2);
  });
});
