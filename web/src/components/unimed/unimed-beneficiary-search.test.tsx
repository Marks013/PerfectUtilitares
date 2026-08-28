import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => {
  const slots: unknown[] = [];
  const pendingEffects: Array<() => void> = [];
  const cleanups = new Map<number, () => void>();
  let cursor = 0;

  function nextSlot(initial: unknown) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return index;
  }

  function sameDependencies(
    previous: readonly unknown[] | undefined,
    next: readonly unknown[],
  ) {
    return (
      previous?.length === next.length &&
      previous.every((value, index) => Object.is(value, next[index]))
    );
  }

  return {
    beginRender() {
      cursor = 0;
    },
    flushEffects() {
      for (const effect of pendingEffects.splice(0)) effect();
    },
    reset() {
      for (const cleanup of cleanups.values()) cleanup();
      cleanups.clear();
      pendingEffects.length = 0;
      slots.length = 0;
      cursor = 0;
    },
    useState<T>(initial: T) {
      const index = nextSlot(initial);
      return [
        slots[index] as T,
        (value: T) => {
          slots[index] = value;
        },
      ] as const;
    },
    useRef<T>(initial: T) {
      return slots[nextSlot({ current: initial })] as { current: T };
    },
    useCallback<T>(callback: T, dependencies: readonly unknown[]) {
      const index = nextSlot(undefined);
      const previous = slots[index] as
        | { callback: T; dependencies: readonly unknown[] }
        | undefined;
      if (!sameDependencies(previous?.dependencies, dependencies)) {
        slots[index] = { callback, dependencies };
      }
      return (slots[index] as { callback: T }).callback;
    },
    useEffect(
      effect: () => undefined | (() => void),
      dependencies: readonly unknown[],
    ) {
      const index = nextSlot(undefined);
      const previous = slots[index] as readonly unknown[] | undefined;
      if (sameDependencies(previous, dependencies)) return;
      slots[index] = dependencies;
      pendingEffects.push(() => {
        cleanups.get(index)?.();
        cleanups.delete(index);
        const cleanup = effect();
        if (cleanup) cleanups.set(index, cleanup);
      });
    },
  };
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useId: () => "unimed-search-test",
  useState: hooks.useState,
  useRef: hooks.useRef,
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
}));

import {
  type UnimedBeneficiary,
  UnimedBeneficiarySearch,
  type UnimedPricingContext,
} from "./unimed-beneficiary-search";

type TestElement = ReactElement<{
  children?: ReactNode;
  disabled?: boolean;
  role?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onKeyDown?: (event: { key: string; preventDefault: () => void }) => void;
  onClick?: () => void;
}>;

function elements(node: ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<TestElement["props"]>(node)) return [];
  return [node, ...elements(node.props.children)];
}

function element(tree: ReactNode, type: string, index = 0): TestElement {
  const found = elements(tree).filter((node) => node.type === type)[index];
  if (!found) throw new Error(`Missing ${type} at index ${index}`);
  return found;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<TestElement["props"]>(node)) {
    return textContent(node.props.children);
  }
  return "";
}

const pricing: UnimedBeneficiary["pricing"] = {
  status: "RESOLVED",
  age: 36,
  ageBracketCode: "ADULT",
  planCode: "TEST",
  companyAmount: "100.00",
  employeeAmount: "25.00",
};
const beneficiary: UnimedBeneficiary = {
  id: "beneficiary-test-5",
  registration: "5",
  fullName: "Titular Teste",
  cpf: null,
  birthDate: "1990-01-01",
  inclusionDate: null,
  category: "HOLDER",
  relationship: null,
  planCode: "TEST",
  planName: "Plano Teste",
  accommodation: null,
  hasAddon: false,
  branch: null,
  pricing,
  dependents: [],
};
const pricingContext: UnimedPricingContext = {
  referenceDate: "2026-08-04",
  dataCompetency: { year: 2026, month: 7 },
  billingClosure: null,
  addonPrices: [],
};
const fetchMock = vi.fn();
const onSelect = vi.fn();

function render() {
  hooks.beginRender();
  const tree = UnimedBeneficiarySearch({
    selected: null,
    referenceDate: pricingContext.referenceDate,
    onSelect,
    onClear: vi.fn(),
  });
  hooks.flushEffects();
  return tree;
}

function typeQuery(query: string) {
  element(render(), "input").props.onChange?.({ target: { value: query } });
  return render();
}

beforeEach(() => {
  hooks.reset();
  vi.useFakeTimers();
  fetchMock.mockReset();
  onSelect.mockReset();
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () =>
    Response.json({
      searchMode: "REGISTRATION",
      beneficiaries: [beneficiary],
      pricingContext,
    }),
  );
});

afterEach(() => {
  hooks.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("UnimedBeneficiarySearch", () => {
  it("automatically searches q=5 after debounce and selects the returned holder", async () => {
    const tree = typeQuery("5");

    expect(element(tree, "button").props.disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(349);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/unimed/beneficiaries?q=5&referenceDate=2026-08-04",
      { cache: "no-store", signal: expect.any(AbortSignal) },
    );
    const results = render();
    expect(textContent(results)).toContain("Titular Teste");
    expect(textContent(results)).toContain("Matrícula 5");
    const result = element(results, "button", 1);
    expect(result.props.disabled).toBe(false);
    result.props.onClick?.();
    expect(onSelect).toHaveBeenCalledWith(beneficiary, pricingContext);
  });

  it.each(["button", "Enter"])(
    "immediately searches a trimmed single digit via %s",
    async (trigger) => {
      const tree = typeQuery(" 5 ");
      expect(element(tree, "button").props.disabled).toBe(false);
      if (trigger === "button") {
        element(tree, "button").props.onClick?.();
      } else {
        const preventDefault = vi.fn();
        element(tree, "input").props.onKeyDown?.({
          key: "Enter",
          preventDefault,
        });
        expect(preventDefault).toHaveBeenCalledOnce();
      }
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toContain("?q=5&");
      expect(textContent(render())).toContain("Titular Teste");
    },
  );

  it.each(["", " ", "a", " a ", "."])(
    "blocks automatic, button and Enter searches for invalid query %s",
    async (query) => {
      const tree = typeQuery(query);
      expect(element(tree, "button").props.disabled).toBe(true);
      element(tree, "button").props.onClick?.();
      element(tree, "input").props.onKeyDown?.({
        key: "Enter",
        preventDefault: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(350);

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "Al", "529.982.247-25"])(
    "retains automatic search for valid query %s",
    async (query) => {
      const tree = typeQuery(query);
      expect(element(tree, "button").props.disabled).toBe(false);
      await vi.advanceTimersByTimeAsync(350);

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toContain(
        `?q=${encodeURIComponent(query)}&`,
      );
    },
  );

  it("aborts a single-digit search and clears results when changed to a short name", async () => {
    let finish: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => { finish = resolve; }),
    );
    typeQuery("5");
    await vi.advanceTimersByTimeAsync(350);
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    typeQuery("a");
    expect(signal.aborted).toBe(true);
    finish?.(Response.json({ beneficiaries: [beneficiary], pricingContext }));
    await vi.advanceTimersByTimeAsync(350);

    const tree = render();
    expect(element(tree, "button").props.disabled).toBe(true);
    expect(elements(tree).filter((node) => node.type === "ul")).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
