import type {
  ParsedAddress,
  ParsedBeneficiary,
  ParsedInvoiceItem,
} from "@/lib/unimed/importer";
import {
  isFuneralAddonDescription,
  key,
  mergeAddress,
  uniqueMap,
} from "./reconcile-support";
import type {
  PreviousUnimedDependentLink,
  UnimedReconciliation,
} from "./reconcile-types";

export type {
  PreviousUnimedDependentLink,
  UnimedReconciliation,
} from "./reconcile-types";

export function reconcileUnimedSources(
  beneficiaries: ParsedBeneficiary[],
  invoiceItems: ParsedInvoiceItem[],
  addresses: ParsedAddress[],
  previousLinks: PreviousUnimedDependentLink[] = [],
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
  const currentHolders = beneficiaries.filter(
    (beneficiary) => beneficiary.category === "HOLDER",
  );
  const holdersByCpf = uniqueMap(currentHolders, (holder) => holder.cpf);
  const holdersByBranchAndRegistration = uniqueMap(
    currentHolders,
    (holder) =>
      holder.registration
        ? `${key(holder.branchCode)}|${key(holder.registration)}`
        : null,
  );

  const previousByDependentCpf = uniqueMap(
    previousLinks,
    (link) => link.dependent.cpf,
  );
  const previousByDependentRegistration = uniqueMap(
    previousLinks,
    (link) =>
      link.dependent.registration
        ? `${key(link.dependent.branchCode)}|${key(link.dependent.registration)}`
        : null,
  );
  const previousByDependentName = uniqueMap(
    previousLinks,
    (link) =>
      `${key(link.dependent.branchCode)}|${key(link.dependent.fullName)}`,
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
    invoiceMatches.flatMap(({ item, beneficiary }) =>
      beneficiary && isFuneralAddonDescription(item.itemDescription)
        ? [beneficiary.sourceKey]
        : [],
    ),
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

  let dependentsLinkedByRegistration = 0;
  let dependentsLinkedFromPreviousCompetency = 0;
  for (const dependent of beneficiaries) {
    if (
      dependent.category !== "DEPENDENT" ||
      holderByDependentSourceKey.has(dependent.sourceKey)
    ) {
      continue;
    }

    const holderByRegistration = dependent.registration
      ? holdersByBranchAndRegistration.get(
          `${key(dependent.branchCode)}|${key(dependent.registration)}`,
        )
      : undefined;
    if (holderByRegistration) {
      holderByDependentSourceKey.set(
        dependent.sourceKey,
        holderByRegistration.sourceKey,
      );
      dependentsLinkedByRegistration += 1;
      continue;
    }

    const previousLink =
      (dependent.cpf
        ? previousByDependentCpf.get(key(dependent.cpf))
        : undefined) ??
      (dependent.registration
        ? previousByDependentRegistration.get(
            `${key(dependent.branchCode)}|${key(dependent.registration)}`,
          )
        : undefined) ??
      previousByDependentName.get(
        `${key(dependent.branchCode)}|${key(dependent.fullName)}`,
      );
    if (!previousLink) continue;

    const previousHolder = previousLink.holder;
    const currentHolder =
      (previousHolder.cpf
        ? holdersByCpf.get(key(previousHolder.cpf))
        : undefined) ??
      (previousHolder.registration
        ? holdersByBranchAndRegistration.get(
            `${key(previousHolder.branchCode)}|${key(previousHolder.registration)}`,
          )
        : undefined) ??
      holdersByBranchAndName.get(
        `${key(previousHolder.branchCode)}|${key(previousHolder.fullName)}`,
      );
    if (!currentHolder) continue;

    holderByDependentSourceKey.set(
      dependent.sourceKey,
      currentHolder.sourceKey,
    );
    dependentsLinkedFromPreviousCompetency += 1;
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

  const branchesByCode = new Map<
    string,
    { code: string; cnpj: string }
  >();

  for (const beneficiary of beneficiaries) {
    const companyCnpj = beneficiary.companyCnpj;
    if (!companyCnpj) continue;

    const branchCode = key(beneficiary.branchCode);
    branchesByCode.set(branchCode, {
      code: branchCode,
      cnpj: companyCnpj,
    });
  }

  return {
    beneficiaries: reconciledBeneficiaries,
    invoiceItems: invoiceMatches.map(({ item, beneficiary }) => ({
      ...item,
      beneficiarySourceKey: beneficiary?.sourceKey ?? null,
    })),
    branches: [...branchesByCode.values()],
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
    information: {
      addressOnlyRows,
      dependentsLinkedByRegistration,
      dependentsLinkedFromPreviousCompetency,
    },
  };
}
