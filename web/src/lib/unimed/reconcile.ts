import type {
  ParsedAddress,
  ParsedBeneficiary,
  ParsedInvoiceItem,
} from "@/lib/unimed/importer";

type AddressFields = ParsedBeneficiary["address"];

type ReconciledBeneficiary = ParsedBeneficiary & {
  holderSourceKey: string | null;
  hasAddon: boolean;
  planCode: string | null;
  address: AddressFields;
};

type ReconciledInvoiceItem = ParsedInvoiceItem & {
  beneficiarySourceKey: string | null;
};

export type UnimedReconciliation = {
  beneficiaries: ReconciledBeneficiary[];
  invoiceItems: ReconciledInvoiceItem[];
  branches: Array<{ code: string; cnpj: string }>;
  warnings: {
    unmatchedInvoiceItems: number;
    unmatchedDependents: number;
    ambiguousPlanCodes: number;
  };
  warningDetails: {
    unmatchedInvoiceItems: Array<{
      sourceKey: string;
      branchCode: string;
      beneficiaryName: string;
      category: ParsedInvoiceItem["category"];
      itemDescription: string;
      reason:
        | "CPF_NOT_FOUND"
        | "CPF_AMBIGUOUS"
        | "REGISTRATION_NOT_FOUND"
        | "REGISTRATION_AMBIGUOUS"
        | "SAFE_IDENTIFIER_MISSING";
    }>;
    unmatchedDependents: Array<{
      sourceKey: string;
      branchCode: string;
      fullName: string;
      reason:
        | "INVOICE_REFERENCE_MISSING"
        | "HOLDER_NAME_MISSING"
        | "HOLDER_NOT_UNIQUE";
    }>;
    ambiguousPlanCodes: Array<{
      sourceKey: string;
      branchCode: string;
      fullName: string;
      planCodes: string[];
    }>;
  };
  information: {
    addressOnlyRows: number;
  };
};

function key(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function isFuneralAddonDescription(value: string | null | undefined) {
  const description = key(value);
  return (
    description.includes("ADITIVO") ||
    description.includes("FUNERAL") ||
    description.includes("ACESSORIO")
  );
}

function nonEmpty<T>(primary: T | null, fallback: T | null) {
  return primary ?? fallback;
}

function mergeAddress(
  current: AddressFields,
  imported: ParsedAddress | undefined,
): AddressFields {
  if (!imported) return current;
  return {
    addressLine: nonEmpty(imported.addressLine, current.addressLine),
    number: nonEmpty(imported.number, current.number),
    complement: current.complement,
    district: nonEmpty(imported.district, current.district),
    postalCode: nonEmpty(imported.postalCode, current.postalCode),
    city: nonEmpty(imported.city, current.city),
    state: nonEmpty(imported.state, current.state),
    pis: nonEmpty(imported.pis, current.pis),
  };
}

function uniqueMap<T>(
  items: T[],
  getKey: (item: T) => string | null | undefined,
) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const normalized = key(getKey(item));
    if (!normalized) continue;
    grouped.set(normalized, [...(grouped.get(normalized) ?? []), item]);
  }
  return new Map(
    [...grouped.entries()]
      .filter(([, matches]) => matches.length === 1)
      .map(([normalized, matches]) => [normalized, matches[0]]),
  );
}

export function reconcileUnimedSources(
  beneficiaries: ParsedBeneficiary[],
  invoiceItems: ParsedInvoiceItem[],
  addresses: ParsedAddress[],
): UnimedReconciliation {
  const beneficiariesByCpf = uniqueMap(
    beneficiaries,
    (beneficiary) => beneficiary.cpf,
  );
  const beneficiariesGroupedByCpf = new Map<string, ParsedBeneficiary[]>();
  for (const beneficiary of beneficiaries) {
    const cpf = key(beneficiary.cpf);
    if (!cpf) continue;
    beneficiariesGroupedByCpf.set(cpf, [
      ...(beneficiariesGroupedByCpf.get(cpf) ?? []),
      beneficiary,
    ]);
  }
  const registrations = new Map<string, ParsedBeneficiary[]>();
  for (const beneficiary of beneficiaries) {
    if (!beneficiary.registration) continue;
    const registration = key(beneficiary.registration);
    registrations.set(registration, [
      ...(registrations.get(registration) ?? []),
      beneficiary,
    ]);
  }
  const beneficiariesByRegistration = new Map(
    [...registrations.entries()]
      .filter(([, matches]) => matches.length === 1)
      .map(([registration, matches]) => [registration, matches[0]]),
  );
  const beneficiariesByBranchAndRegistration = uniqueMap(
    beneficiaries,
    (beneficiary) =>
      beneficiary.registration
        ? `${key(beneficiary.branchCode)}|${key(beneficiary.registration)}`
        : null,
  );
  const holdersByBranchAndName = uniqueMap(
    beneficiaries.filter((beneficiary) => beneficiary.category === "HOLDER"),
    (beneficiary) =>
      `${key(beneficiary.branchCode)}|${key(beneficiary.fullName)}`,
  );

  const matchBeneficiary = (
    branchCode: string,
    cpf?: string | null,
    registration?: string | null,
  ):
    | { beneficiary: ParsedBeneficiary; reason: null }
    | {
        beneficiary: null;
        reason: UnimedReconciliation["warningDetails"]["unmatchedInvoiceItems"][number]["reason"];
      } => {
    if (cpf) {
      const matches = beneficiariesGroupedByCpf.get(key(cpf)) ?? [];
      if (matches.length === 1) {
        return { beneficiary: matches[0], reason: null };
      }
      return {
        beneficiary: null,
        reason: matches.length > 1 ? "CPF_AMBIGUOUS" : "CPF_NOT_FOUND",
      };
    }
    if (registration) {
      const byRegistration = beneficiariesByBranchAndRegistration.get(
        `${key(branchCode)}|${key(registration)}`,
      );
      if (byRegistration) {
        return { beneficiary: byRegistration, reason: null };
      }
      const registrationMatches = beneficiaries.filter(
        (beneficiary) =>
          key(beneficiary.branchCode) === key(branchCode) &&
          key(beneficiary.registration) === key(registration),
      );
      return {
        beneficiary: null,
        reason:
          registrationMatches.length > 1
            ? "REGISTRATION_AMBIGUOUS"
            : "REGISTRATION_NOT_FOUND",
      };
    }
    return { beneficiary: null, reason: "SAFE_IDENTIFIER_MISSING" };
  };

  const externalAddressBySourceKey = new Map<string, ParsedAddress>();
  let addressOnlyRows = 0;
  for (const address of addresses) {
    const match = address.cpf
      ? beneficiariesByCpf.get(key(address.cpf))
      : address.registration
        ? beneficiariesByRegistration.get(key(address.registration))
        : undefined;
    if (match) {
      externalAddressBySourceKey.set(match.sourceKey, address);
    } else {
      addressOnlyRows += 1;
    }
  }

  const invoiceMatches = invoiceItems.map((item) => {
    const match = matchBeneficiary(
      item.branchCode,
      item.cpf,
      item.registration,
    );
    return { item, ...match };
  });
  const planItemsBySourceKey = new Map<
    string,
    Array<{ planCode: string; priority: number }>
  >();
  for (const { item, beneficiary } of invoiceMatches) {
    if (!beneficiary || !item.planCode) continue;
    const description = key(item.itemDescription);
    const priority = description.includes("MENSALIDADE")
      ? 3
      : description.includes("PRO-RATA")
        ? 2
        : 1;
    planItemsBySourceKey.set(beneficiary.sourceKey, [
      ...(planItemsBySourceKey.get(beneficiary.sourceKey) ?? []),
      { planCode: item.planCode, priority },
    ]);
  }
  const authoritativePlanCodesBySourceKey = new Map<
    string,
    Map<string, string>
  >();
  for (const [sourceKey, items] of planItemsBySourceKey) {
    const highestPriority = Math.max(...items.map((item) => item.priority));
    const codes = new Map<string, string>();
    for (const item of items) {
      if (item.priority === highestPriority) {
        codes.set(key(item.planCode), item.planCode);
      }
    }
    authoritativePlanCodesBySourceKey.set(sourceKey, codes);
  }
  const uniquePlanCodeBySourceKey = new Map(
    [...authoritativePlanCodesBySourceKey.entries()]
      .filter(([, codes]) => codes.size === 1)
      .map(([sourceKey, codes]) => [sourceKey, [...codes.values()][0]]),
  );
  const addonSourceKeys = new Set(
    invoiceMatches
      .filter(
        ({ item, beneficiary }) =>
          beneficiary && isFuneralAddonDescription(item.itemDescription),
      )
      .map(({ beneficiary }) => beneficiary!.sourceKey),
  );

  const holderByDependentSourceKey = new Map<string, string>();
  for (const { item, beneficiary } of invoiceMatches) {
    if (
      beneficiary?.category !== "DEPENDENT" ||
      !item.holderName ||
      holderByDependentSourceKey.has(beneficiary.sourceKey)
    ) {
      continue;
    }
    const holder = holdersByBranchAndName.get(
      `${key(item.branchCode)}|${key(item.holderName)}`,
    );
    if (holder?.category === "HOLDER") {
      holderByDependentSourceKey.set(beneficiary.sourceKey, holder.sourceKey);
    }
  }

  const unmatchedInvoiceDetails = invoiceMatches
    .filter(
      (
        match,
      ): match is typeof match & {
        beneficiary: null;
        reason: NonNullable<typeof match.reason>;
      } => !match.beneficiary && Boolean(match.reason),
    )
    .map(({ item, reason }) => ({
      sourceKey: item.sourceKey,
      branchCode: item.branchCode,
      beneficiaryName: item.beneficiaryName,
      category: item.category,
      itemDescription: item.itemDescription,
      reason,
    }));

  const unmatchedDependentDetails = beneficiaries
    .filter(
      (beneficiary) =>
        beneficiary.category === "DEPENDENT" &&
        !holderByDependentSourceKey.has(beneficiary.sourceKey),
    )
    .map((beneficiary) => {
      const matchedItems = invoiceMatches.filter(
        ({ beneficiary: matched }) =>
          matched?.sourceKey === beneficiary.sourceKey,
      );
      const reason =
        matchedItems.length === 0
          ? ("INVOICE_REFERENCE_MISSING" as const)
          : matchedItems.every(({ item }) => !item.holderName)
            ? ("HOLDER_NAME_MISSING" as const)
            : ("HOLDER_NOT_UNIQUE" as const);
      return {
        sourceKey: beneficiary.sourceKey,
        branchCode: beneficiary.branchCode,
        fullName: beneficiary.fullName,
        reason,
      };
    });

  const ambiguousPlanDetails = beneficiaries.flatMap((beneficiary) => {
    const codes = authoritativePlanCodesBySourceKey.get(beneficiary.sourceKey);
    if (!codes || codes.size <= 1) return [];
    return [
      {
        sourceKey: beneficiary.sourceKey,
        branchCode: beneficiary.branchCode,
        fullName: beneficiary.fullName,
        planCodes: [...codes.values()].sort(),
      },
    ];
  });

  const reconciledBeneficiaries = beneficiaries.map((beneficiary) => {
    const externalAddress = externalAddressBySourceKey.get(
      beneficiary.sourceKey,
    );
    return {
      ...beneficiary,
      registration: externalAddress?.registration ?? beneficiary.registration,
      holderSourceKey:
        beneficiary.category === "DEPENDENT"
          ? (holderByDependentSourceKey.get(beneficiary.sourceKey) ?? null)
          : null,
      hasAddon: addonSourceKeys.has(beneficiary.sourceKey),
      planCode: uniquePlanCodeBySourceKey.get(beneficiary.sourceKey) ?? null,
      address: mergeAddress(beneficiary.address, externalAddress),
    };
  });

  return {
    beneficiaries: reconciledBeneficiaries,
    invoiceItems: invoiceMatches.map(({ item, beneficiary }) => ({
      ...item,
      beneficiarySourceKey: beneficiary?.sourceKey ?? null,
    })),
    branches: [
      ...new Map(
        beneficiaries
          .filter((beneficiary) => beneficiary.companyCnpj)
          .map((beneficiary) => [
            key(beneficiary.branchCode),
            {
              code: key(beneficiary.branchCode),
              cnpj: beneficiary.companyCnpj!,
            },
          ]),
      ).values(),
    ],
    warnings: {
      unmatchedInvoiceItems: unmatchedInvoiceDetails.length,
      unmatchedDependents: unmatchedDependentDetails.length,
      ambiguousPlanCodes: ambiguousPlanDetails.length,
    },
    warningDetails: {
      unmatchedInvoiceItems: unmatchedInvoiceDetails,
      unmatchedDependents: unmatchedDependentDetails,
      ambiguousPlanCodes: ambiguousPlanDetails,
    },
    information: { addressOnlyRows },
  };
}
