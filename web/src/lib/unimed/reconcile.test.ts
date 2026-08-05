import { describe, expect, it } from "vitest";
import type {
  ParsedAddress,
  ParsedBeneficiary,
  ParsedInvoiceItem,
} from "@/lib/unimed/importer";
import { reconcileUnimedSources } from "@/lib/unimed/reconcile";

const emptyAddress = {
  addressLine: null,
  number: null,
  complement: null,
  district: null,
  postalCode: null,
  city: null,
  state: null,
  pis: null,
};

function beneficiary(
  sourceKey: string,
  fullName: string,
  category: "HOLDER" | "DEPENDENT",
  cpf: string,
): ParsedBeneficiary {
  return {
    sourceKey,
    branchCode: "MATRIZ",
    registration: sourceKey,
    fullName,
    cpf,
    birthDate: "1990-01-01",
    inclusionDate: "2022-01-08",
    category,
    relationship: category === "HOLDER" ? "Titular" : "Filho",
    planName: "Plano",
    accommodation: "Enfermaria",
    companyCnpj: "76361807000111",
    address: emptyAddress,
  };
}

function invoice(
  overrides: Partial<ParsedInvoiceItem> = {},
): ParsedInvoiceItem {
  return {
    sourceKey: "MATRIZ.csv:2",
    branchCode: "MATRIZ",
    contract: "1",
    registration: null,
    cpf: null,
    card: "CARD",
    beneficiaryName: "Pessoa Exemplo",
    holderName: null,
    relationship: "Titular",
    category: "HOLDER",
    accommodation: "Enfermaria",
    itemCode: "1",
    itemDescription: "MENSALIDADE",
    amount: 10,
    planCode: "1013",
    ...overrides,
  };
}

describe("Unimed source reconciliation", () => {
  it("links dependents, add-ons, invoice items and current addresses", () => {
    const beneficiaries = [
      beneficiary("H1", "Titular Exemplo", "HOLDER", "52998224725"),
      beneficiary("D1", "Dependente Exemplo", "DEPENDENT", "11144477735"),
    ];
    const invoiceItems: ParsedInvoiceItem[] = [
      {
        sourceKey: "MATRIZ.csv:2",
        branchCode: "MATRIZ",
        contract: "1",
        registration: "D1",
        cpf: "11144477735",
        card: "CARD",
        beneficiaryName: "Dependente Exemplo",
        holderName: "Titular Exemplo",
        relationship: "Filho",
        category: "DEPENDENT",
        accommodation: "Enfermaria",
        itemCode: "1",
        itemDescription: "ADITIVO",
        amount: 10,
        planCode: "1013",
      },
      invoice({
        sourceKey: "MATRIZ.csv:3",
        registration: "H1",
        cpf: "52998224725",
        beneficiaryName: "Titular Exemplo",
        itemDescription: "ACESSÓRIO FUNERAL",
      }),
    ];
    const addresses: ParsedAddress[] = [
      {
        registration: "D1",
        fullName: "Dependente Exemplo",
        cpf: "11144477735",
        addressLine: "Rua Atual",
        number: "10",
        district: "Centro",
        postalCode: "87000000",
        city: "Cidade",
        state: "PR",
        pis: null,
      },
    ];

    const result = reconcileUnimedSources(
      beneficiaries,
      invoiceItems,
      addresses,
    );
    const dependent = result.beneficiaries.find(
      (item) => item.sourceKey === "D1",
    );
    const holder = result.beneficiaries.find((item) => item.sourceKey === "H1");

    expect(dependent).toMatchObject({
      holderSourceKey: "H1",
      hasAddon: true,
      planCode: "1013",
      address: { addressLine: "Rua Atual" },
    });
    expect(holder?.hasAddon).toBe(true);
    expect(result.invoiceItems[0].beneficiarySourceKey).toBe("D1");
    expect(result.warnings).toEqual({
      unmatchedInvoiceItems: 0,
      unmatchedDependents: 0,
      ambiguousPlanCodes: 0,
    });
    expect(result.information).toEqual({ addressOnlyRows: 0 });
  });

  it("uses a unique registration within the branch when CPF is absent", () => {
    const person = beneficiary(
      "H1",
      "Pessoa Cadastrada",
      "HOLDER",
      "52998224725",
    );
    person.registration = "200";

    const result = reconcileUnimedSources(
      [person],
      [
        invoice({
          registration: "200",
          beneficiaryName: "Nome Divergente na Fatura",
        }),
      ],
      [],
    );

    expect(result.invoiceItems[0].beneficiarySourceKey).toBe("H1");
  });

  it("prioritizes CPF and never redirects a match through conflicting registration", () => {
    const first = beneficiary("H1", "Pessoa CPF", "HOLDER", "52998224725");
    const second = beneficiary(
      "H2",
      "Pessoa Matrícula",
      "HOLDER",
      "11144477735",
    );
    first.registration = "100";
    second.registration = "200";

    const result = reconcileUnimedSources(
      [first, second],
      [invoice({ cpf: first.cpf, registration: "200" })],
      [
        {
          registration: "200",
          fullName: first.fullName,
          cpf: first.cpf,
          addressLine: "Rua do CPF",
          number: null,
          district: null,
          postalCode: null,
          city: null,
          state: null,
          pis: null,
        },
      ],
    );

    expect(result.invoiceItems[0].beneficiarySourceKey).toBe("H1");
    expect(result.beneficiaries[0].address.addressLine).toBe("Rua do CPF");
    expect(result.beneficiaries[1].address.addressLine).not.toBe("Rua do CPF");
  });

  it("does not correlate sensitive data by name alone", () => {
    const person = beneficiary("H1", "Mesmo Nome", "HOLDER", "52998224725");
    const result = reconcileUnimedSources(
      [person],
      [
        invoice({
          cpf: null,
          registration: null,
          beneficiaryName: person.fullName,
        }),
      ],
      [
        {
          registration: null,
          fullName: person.fullName,
          cpf: null,
          addressLine: "Rua sem chave segura",
          number: null,
          district: null,
          postalCode: null,
          city: null,
          state: null,
          pis: null,
        },
      ],
    );

    expect(result.invoiceItems[0].beneficiarySourceKey).toBeNull();
    expect(result.information.addressOnlyRows).toBe(1);
    expect(result.beneficiaries[0].address.addressLine).not.toBe(
      "Rua sem chave segura",
    );
  });

  it("does not use an ambiguous registration or duplicated CPF", () => {
    const first = beneficiary("H1", "Primeira Pessoa", "HOLDER", "52998224725");
    const second = beneficiary("H2", "Segunda Pessoa", "HOLDER", "52998224725");
    first.registration = "200";
    second.registration = "200";

    const result = reconcileUnimedSources(
      [first, second],
      [
        invoice({
          registration: "200",
          cpf: "52998224725",
          beneficiaryName: "Primeira Pessoa",
        }),
        invoice({
          sourceKey: "MATRIZ.csv:3",
          registration: "200",
          beneficiaryName: "Nome sem Correspondencia",
        }),
      ],
      [],
    );

    expect(result.invoiceItems[0].beneficiarySourceKey).toBeNull();
    expect(result.invoiceItems[1].beneficiarySourceKey).toBeNull();
    expect(result.warnings.unmatchedInvoiceItems).toBe(2);
  });

  it("uses the monthly charge as the authoritative plan code", () => {
    const person = beneficiary("H1", "Pessoa Exemplo", "HOLDER", "52998224725");
    const result = reconcileUnimedSources(
      [person],
      [
        invoice({
          cpf: person.cpf,
          planCode: "1013",
          itemDescription: "MENSALIDADE",
        }),
        invoice({
          sourceKey: "MATRIZ.csv:3",
          cpf: person.cpf,
          planCode: "1014",
          itemDescription: "COPARTICIPACAO",
        }),
      ],
      [],
    );

    expect(result.beneficiaries[0].planCode).toBe("1013");
    expect(result.warnings.ambiguousPlanCodes).toBe(0);
  });

  it("keeps two monthly plan codes ambiguous instead of guessing", () => {
    const person = beneficiary("H1", "Pessoa Exemplo", "HOLDER", "52998224725");
    const result = reconcileUnimedSources(
      [person],
      [
        invoice({
          cpf: person.cpf,
          planCode: "1013",
          itemDescription: "MENSALIDADE",
        }),
        invoice({
          sourceKey: "MATRIZ.csv:3",
          cpf: person.cpf,
          planCode: "1014",
          itemDescription: "MENSALIDADE",
        }),
      ],
      [],
    );

    expect(result.beneficiaries[0].planCode).toBeNull();
    expect(result.warnings.ambiguousPlanCodes).toBe(1);
  });

  it("does not attach an address when registration is duplicated", () => {
    const first = beneficiary(
      "H1",
      "Pessoa da Matriz",
      "HOLDER",
      "52998224725",
    );
    const second = beneficiary(
      "H2",
      "Pessoa de Outra Loja",
      "HOLDER",
      "11144477735",
    );
    first.registration = "100";
    second.registration = "100";
    second.branchCode = "ANCHIETA";

    const result = reconcileUnimedSources(
      [first, second],
      [],
      [
        {
          registration: "100",
          fullName: "Nome sem correspondência",
          cpf: null,
          addressLine: "Rua Incorreta",
          number: null,
          district: null,
          postalCode: null,
          city: null,
          state: null,
          pis: null,
        },
      ],
    );

    expect(result.information.addressOnlyRows).toBe(1);
    expect(
      result.beneficiaries.every(
        (item) => item.address.addressLine !== "Rua Incorreta",
      ),
    ).toBe(true);
  });
});
