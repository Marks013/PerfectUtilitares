import { calculateUnimed } from "@/lib/unimed/calculation";
import { resolveUnimedPlanPrice } from "@/lib/unimed/pricing";
import type { UnimedCalculationInput } from "@/lib/unimed/types";

const DATABASE_NAME = "perfectutilitares-unimed-offline";
const DATABASE_VERSION = 1;
const DEVICE_KEY = "perfectutilitares-unimed-device-id";
const BUNDLE_ID = "current";

type DateRange = { validFrom: string; validTo: string | null };

type OfflinePerson = {
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
};

type OfflineDependent = OfflinePerson;

type OfflineBeneficiary = OfflinePerson & {
  competencyId?: string;
  branch: { code: string; name: string } | null;
  holder: { id: string; fullName: string } | null;
  address: {
    addressLine: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    postalCode: string | null;
    city: string | null;
    state: string | null;
  } | null;
  dependents: OfflineDependent[];
};

export type UnimedOfflineBundle = {
  version: string;
  generatedAt: string;
  expiresAt: string;
  competency: { id: string; year: number; month: number } | null;
  competencies?: Array<{ id: string; year: number; month: number }>;
  beneficiaries: OfflineBeneficiary[];
  configuration: {
    ageBrackets: Array<{ code: string; minAge: number; maxAge: number | null }>;
    planPrices: Array<
      DateRange & {
        planCode: string;
        ageBracketCode: string;
        companyAmount: string;
        employeeAmount: string;
      }
    >;
    addonPrices: Array<
      DateRange & { code: string; label: string; amount: string }
    >;
    billing: Array<
      DateRange & {
        closure: "OPEN" | "AUTOMATIC_DAY_25";
        closingDay: number | null;
      }
    >;
  };
};

type SecureRecord = {
  id: string;
  iv: ArrayBuffer;
  payload: ArrayBuffer;
};

export type OfflineAction = {
  id: string;
  endpoint: "/api/unimed/email";
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
};

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("secure")) {
        database.createObjectStore("secure", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("keys")) {
        database.createObjectStore("keys", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("outbox")) {
        database.createObjectStore("outbox", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function cryptoKey(database: IDBDatabase) {
  const read = database.transaction("keys", "readonly").objectStore("keys");
  const stored = (await requestResult(read.get("bundle-key"))) as
    | { id: string; key: CryptoKey }
    | undefined;
  if (stored?.key) return stored.key;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const write = database.transaction("keys", "readwrite").objectStore("keys");
  await requestResult(write.put({ id: "bundle-key", key }));
  return key;
}

function getUnimedDeviceId() {
  let deviceId = localStorage.getItem(DEVICE_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, deviceId);
  }
  return deviceId;
}

async function saveUnimedOfflineBundle(bundle: UnimedOfflineBundle) {
  const database = await openDatabase();
  try {
    const key = await cryptoKey(database);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(bundle)),
    );
    const store = database
      .transaction("secure", "readwrite")
      .objectStore("secure");
    await requestResult(
      store.put({ id: BUNDLE_ID, iv: iv.buffer, payload } satisfies SecureRecord),
    );
  } finally {
    database.close();
  }
}

export async function loadUnimedOfflineBundle() {
  const database = await openDatabase();
  try {
    const store = database
      .transaction("secure", "readonly")
      .objectStore("secure");
    const record = (await requestResult(store.get(BUNDLE_ID))) as
      | SecureRecord
      | undefined;
    if (!record) return null;
    const key = await cryptoKey(database);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: record.iv },
      key,
      record.payload,
    );
    return JSON.parse(new TextDecoder().decode(decrypted)) as UnimedOfflineBundle;
  } finally {
    database.close();
  }
}

export async function clearUnimedOfflineData() {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  if ("caches" in globalThis) {
    const names = await caches.keys().catch(() => []);
    await Promise.all(
      names
        .filter((name) => name.startsWith("perfectutilitares-unimed-"))
        .map((name) => caches.delete(name)),
    );
  }
}

export async function syncUnimedOfflineBundle() {
  const userAgentNavigator = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const response = await fetch("/api/unimed/offline/bootstrap", {
    cache: "no-store",
    headers: {
      "x-unimed-device-id": getUnimedDeviceId(),
      "x-unimed-device-label":
        userAgentNavigator.userAgentData?.platform || "Navegador",
    },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await clearUnimedOfflineData();
    }
    throw new Error("Não foi possível atualizar os dados offline.");
  }
  const body = (await response.json()) as { bundle: UnimedOfflineBundle };
  await saveUnimedOfflineBundle(body.bundle);
  return body.bundle;
}

function within(date: string, range: DateRange) {
  return date >= range.validFrom && (!range.validTo || date <= range.validTo);
}

function searchMode(query: string) {
  const digits = query.replace(/\D/g, "");
  const numeric = /^[\d.()\-/\s]+$/.test(query);
  if (numeric && digits.length === 11) return { mode: "CPF", value: digits };
  if (numeric && digits.length > 0) {
    return { mode: "REGISTRATION", value: digits };
  }
  return { mode: "NAME", value: query.toLocaleUpperCase("pt-BR") };
}

export function searchUnimedOfflineBundle(
  bundle: UnimedOfflineBundle,
  rawQuery: string,
  referenceDate?: string,
) {
  if (Date.now() > Date.parse(bundle.expiresAt)) return null;
  const query = rawQuery.trim();
  const classified = searchMode(query);
  const date = referenceDate || new Date().toISOString().slice(0, 10);
  const referenceCompetency = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
  const availableCompetencies = (bundle.competencies?.length
    ? bundle.competencies
    : bundle.competency
      ? [bundle.competency]
      : []
  ).filter(
    (competency) => competency.year * 12 + competency.month <= referenceCompetency,
  );
  const matchesQuery = (beneficiary: OfflineBeneficiary) => {
      if (classified.mode === "CPF") {
        return (
          beneficiary.cpf === classified.value ||
          beneficiary.dependents.some(
            (dependent) => dependent.cpf === classified.value,
          )
        );
      }
      if (classified.mode === "REGISTRATION") {
        return (
          beneficiary.registration === classified.value &&
          Boolean(beneficiary.address)
        );
      }
      return [beneficiary, ...beneficiary.dependents].some((candidate) =>
        candidate.fullName
          .toLocaleUpperCase("pt-BR")
          .includes(classified.value),
      );
  };
  let selectedCompetency = availableCompetencies[0] ?? null;
  let matches: OfflineBeneficiary[] = [];
  for (const competency of availableCompetencies.slice(0, 2)) {
    const competencyMatches = bundle.beneficiaries
      .filter(
        (beneficiary) =>
          !beneficiary.competencyId ||
          beneficiary.competencyId === competency.id,
      )
      .filter(matchesQuery)
      .slice(0, 20);
    if (competencyMatches.length > 0) {
      selectedCompetency = competency;
      matches = competencyMatches;
      break;
    }
  }

  const prices = bundle.configuration.planPrices.filter((price) =>
    within(date, price),
  );
  const pricingFor = (beneficiary: OfflinePerson) =>
    resolveUnimedPlanPrice({
      birthDate: beneficiary.birthDate
        ? new Date(`${beneficiary.birthDate.slice(0, 10)}T00:00:00.000Z`)
        : null,
      referenceDate: new Date(`${date}T00:00:00.000Z`),
      planCode: beneficiary.planCode,
      ageBrackets: bundle.configuration.ageBrackets,
      prices,
    });
  const billing = bundle.configuration.billing.find((item) => within(date, item));
  const addonPrices = bundle.configuration.addonPrices
    .filter((item) => within(date, item))
    .map(({ code, label, amount }) => ({ code, label, amount }));

  return {
    searchMode: classified.mode,
    beneficiaries: matches.map((beneficiary) => ({
      ...beneficiary,
      pricing: pricingFor(beneficiary),
      dependents: beneficiary.dependents.map((dependent) => ({
        ...dependent,
        category: "DEPENDENT" as const,
        pricing: pricingFor(dependent),
      })),
    })),
    pricingContext: {
      referenceDate: date,
      dataCompetency: selectedCompetency
        ? { year: selectedCompetency.year, month: selectedCompetency.month }
        : null,
      billingClosure: billing?.closure ?? null,
      addonPrices,
    },
  };
}

export async function searchUnimedOffline(
  rawQuery: string,
  referenceDate?: string,
) {
  const bundle = await loadUnimedOfflineBundle();
  if (!bundle) return null;
  return searchUnimedOfflineBundle(bundle, rawQuery, referenceDate);
}

function nextCompetencyDate(date: string) {
  const current = new Date(`${date}T00:00:00.000Z`);
  return new Date(
    Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1),
  )
    .toISOString()
    .slice(0, 10);
}

function officialOfflineMoney(
  bundle: UnimedOfflineBundle,
  people: OfflinePerson[],
  referenceDate: string,
) {
  const prices = bundle.configuration.planPrices.filter((price) =>
    within(referenceDate, price),
  );
  const resolved = people.map((person) => ({
    person,
    pricing: resolveUnimedPlanPrice({
      birthDate: person.birthDate
        ? new Date(`${person.birthDate.slice(0, 10)}T00:00:00.000Z`)
        : null,
      referenceDate: new Date(`${referenceDate}T00:00:00.000Z`),
      planCode: person.planCode,
      ageBrackets: bundle.configuration.ageBrackets,
      prices,
    }),
  }));
  if (resolved.some(({ pricing }) => pricing.status !== "RESOLVED")) {
    throw new Error(
      `Não há preço oficial offline único para a competência ${referenceDate.slice(0, 7)}.`,
    );
  }
  const addonPrices = bundle.configuration.addonPrices.filter((price) =>
    within(referenceDate, price),
  );
  if (people.some((person) => person.hasAddon) && addonPrices.length !== 1) {
    throw new Error(
      `Não há valor único de Acessório Funeral offline para ${referenceDate.slice(0, 7)}.`,
    );
  }
  const addonAmount = Number(addonPrices[0]?.amount ?? 0);
  const money = resolved.map(({ person, pricing }) => {
    if (pricing.status !== "RESOLVED") {
      throw new Error("Preço oficial offline indisponível.");
    }
    return {
      invoicePlanAmount: Number(pricing.companyAmount),
      payrollPlanAmount: Number(pricing.employeeAmount),
      addonAmount: person.hasAddon ? addonAmount : 0,
    };
  });
  const holderMoney = money[0];
  if (!holderMoney) throw new Error("Titular offline inválido.");
  return {
    holder: holderMoney,
    dependents: money.slice(1).map(({ invoicePlanAmount, addonAmount }) => ({
      invoicePlanAmount,
      addonAmount,
    })),
  };
}

type OfflineCalculationRequest = {
  beneficiaryId: string;
  dependentIds: string[];
  reasonCode: number;
  exclusionDate: string;
};

export function calculateUnimedFromOfflineBundle(
  bundle: UnimedOfflineBundle,
  input: OfflineCalculationRequest,
) {
  if (Date.now() > Date.parse(bundle.expiresAt)) return null;
  const holder = bundle.beneficiaries.find(
    (beneficiary) => beneficiary.id === input.beneficiaryId,
  );
  if (!holder?.inclusionDate) {
    throw new Error("O cadastro offline não possui a data de inclusão do titular.");
  }
  const dependentById = new Map(
    holder.dependents.map((dependent) => [dependent.id, dependent]),
  );
  const dependents = input.dependentIds.flatMap((id) => {
    const dependent = dependentById.get(id);
    return dependent ? [dependent] : [];
  });
  if (dependents.length !== input.dependentIds.length) {
    throw new Error("Atualize a base offline antes de calcular este dependente.");
  }
  const billing = bundle.configuration.billing.find((item) =>
    within(input.exclusionDate, item),
  );
  if (!billing) {
    throw new Error("Não há fechamento de fatura offline para a data informada.");
  }
  const currentMoney = officialOfflineMoney(
    bundle,
    [holder, ...dependents],
    input.exclusionDate,
  );
  const cutoffApplied =
    billing.closure === "AUTOMATIC_DAY_25" &&
    Number(input.exclusionDate.slice(8, 10)) >= 25;
  const nextMoney = cutoffApplied
    ? officialOfflineMoney(
        bundle,
        [holder, ...dependents],
        nextCompetencyDate(input.exclusionDate),
      )
    : null;
  const officialInput: UnimedCalculationInput = {
    reasonCode: input.reasonCode,
    exclusionDate: input.exclusionDate,
    planEnrollmentDate: holder.inclusionDate.slice(0, 10),
    billingClosure: billing.closure,
    holder: currentMoney.holder,
    dependents: currentMoney.dependents,
    ...(nextMoney ? { nextCompetency: nextMoney } : {}),
  };
  return {
    calculation: calculateUnimed(officialInput),
    officialInput,
    payrollLoans: null,
  };
}

export async function calculateUnimedOffline(input: OfflineCalculationRequest) {
  const bundle = await loadUnimedOfflineBundle();
  if (!bundle) return null;
  return calculateUnimedFromOfflineBundle(bundle, input);
}

export async function queueUnimedOfflineAction(
  action: Omit<OfflineAction, "attempts" | "createdAt">,
) {
  const database = await openDatabase();
  try {
    const store = database
      .transaction("outbox", "readwrite")
      .objectStore("outbox");
    await requestResult(
      store.put({ ...action, attempts: 0, createdAt: new Date().toISOString() }),
    );
  } finally {
    database.close();
  }
}

export async function flushUnimedOfflineOutbox() {
  const database = await openDatabase();
  try {
    const read = database
      .transaction("outbox", "readonly")
      .objectStore("outbox");
    const actions = (await requestResult(read.getAll())) as OfflineAction[];
    let sent = 0;
    for (const action of actions.sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )) {
      try {
        const response = await fetch(action.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action.body),
        });
        if (response.ok) {
          const write = database
            .transaction("outbox", "readwrite")
            .objectStore("outbox");
          await requestResult(write.delete(action.id));
          sent += 1;
          continue;
        }
        if (response.status === 401 || response.status === 403) break;
        const write = database
          .transaction("outbox", "readwrite")
          .objectStore("outbox");
        await requestResult(
          write.put({
            ...action,
            attempts: action.attempts + 1,
            lastError: `HTTP_${response.status}`,
          }),
        );
      } catch {
        break;
      }
    }
    return sent;
  } finally {
    database.close();
  }
}
