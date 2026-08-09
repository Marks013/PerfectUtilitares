import { describe, expect, it } from "vitest";

import { parseUnimedMasterWorkbook } from "./master-workbook";

const beneficiaryHeader = [
  "CODIGO",
  "NOME",
  "MATRICULA",
  "CATEGORIA",
  "CPF",
  "DATA DE NASCIMENTO",
  "PLANO",
  "DATA DE INCLUSAO",
  "CNPJ",
  "LOCAÇÃO",
];

const invoiceHeader = [
  "CONTRATO",
  "MATRICULA",
  "CPF",
  "CODIGO",
  "CARTAO",
  "BENEFICIARIO",
  "TITULAR",
  "PARENTESCO",
  "CATEGORIA",
  "ACOMODACAO",
  "ITEM",
  "VALOR",
  "PLANO",
];

const addressHeader = [
  "Cadastro",
  "Nome",
  "CPF",
  "Endereço",
  "Bairro",
  "Cep",
  "Cidade",
  "UF",
  "PIS",
  "N",
];

describe("Unimed master workbook", () => {
  it("parses the three authoritative sheets in one operation", () => {
    const parsed = parseUnimedMasterWorkbook("CALCULO UNIMED.xlsm", [
      {
        sheet: "Unimed",
        data: [
          beneficiaryHeader,
          [
            "1",
            "Maria Silva",
            "100",
            "TITULAR",
            "52998224725",
            32874,
            "PLANO A",
            43831,
            "11222333000181",
            "MATRIZ",
          ],
          ["", "Relatório gerado automaticamente"],
          ["", "0", "", "TITULAR", "", new Date("2026-07-01T00:00:00.000Z")],
          ["", "-", "", "TITULAR", "", new Date("2026-07-01T00:00:00.000Z")],
        ],
      },
      {
        sheet: "Fatura",
        data: [
          invoiceHeader,
          [
            "1",
            "100",
            "52998224725",
            "10",
            "CARD-1",
            "Maria Silva",
            "Maria Silva",
            "TITULAR",
            "TITULAR",
            "ENFERMARIA",
            "MENSALIDADE",
            "100,00",
            "1013",
          ],
        ],
      },
      {
        sheet: "Endereço",
        data: [
          addressHeader,
          [
            "100",
            "Maria Silva",
            "52998224725",
            "Rua A",
            "Centro",
            "87000000",
            "Maringá",
            "PR",
            "",
            "10",
          ],
        ],
      },
    ]);

    expect(parsed.beneficiaries.rows).toHaveLength(1);
    expect(parsed.beneficiaries.rows[0]).toMatchObject({
      branchCode: "MATRIZ",
      fullName: "Maria Silva",
      birthDate: "1990-01-01",
      inclusionDate: "2020-01-01",
    });
    expect(parsed.beneficiaries.rejectedCount).toBe(0);
    expect(parsed.invoiceItems.rows).toHaveLength(1);
    expect(parsed.invoiceItems.rows[0]).toMatchObject({
      branchCode: "MATRIZ",
      beneficiaryName: "Maria Silva",
    });
    expect(parsed.addresses.rows).toHaveLength(1);
  });

  it("rejects an incomplete workbook without replacing prior sources", () => {
    expect(() =>
      parseUnimedMasterWorkbook("incompleta.xlsm", [
        { sheet: "Unimed", data: [beneficiaryHeader] },
      ]),
    ).toThrow(/faltam as abas obrigatórias/i);
  });
});
