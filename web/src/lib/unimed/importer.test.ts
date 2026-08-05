import { describe, expect, it } from "vitest";
import {
  isValidCnpj,
  isValidCpf,
  parseAddressRows,
  parseBeneficiaryCsvFiles,
  parseBrazilianMoney,
  parseInvoiceCsvFiles,
  parsePayrollLoanRows,
} from "@/lib/unimed/importer";

function csvFile(name: string, rows: string[]) {
  return { name, bytes: Buffer.from(rows.join("\n"), "utf8") };
}

describe("Unimed importer", () => {
  it("parses Brazilian amounts and rounds them to cents", () => {
    expect(parseBrazilianMoney("1.234,567")).toBe(1234.57);
    expect(parseBrazilianMoney("10,075")).toBe(10.08);
    expect(parseBrazilianMoney("-10,075")).toBe(-10.08);
    expect(parseBrazilianMoney("-72,6")).toBe(-72.6);
    expect(parseBrazilianMoney("inválido")).toBeNull();
  });

  it("validates CPF and CNPJ check digits", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("76.361.807/0001-11")).toBe(true);
    expect(isValidCnpj("76.361.807/0001-10")).toBe(false);
  });

  it("normalizes a beneficiary CSV without keeping the original file", () => {
    const result = parseBeneficiaryCsvFiles([
      csvFile("MATRIZ.csv", [
        [
          "CODIGO",
          "NOME",
          "MATRICULA",
          "CATEGORIA",
          "CPF",
          "RG",
          "DATA DE NASCIMENTO",
          "PLANO",
          "DATA DE INCLUSAO",
          "CNPJ",
          "GRAU DE PARENTESCO",
          "ACOMODACAO",
          "ENDEREÇO",
          "N° CASA",
          "COMPLEMENTO",
          "BAIRRO",
          "CIDADE",
          "ESTADO",
          "CEP",
          "PIS",
        ].join(";"),
        [
          "B001",
          "Pessoa Exemplo",
          "10",
          "Titular",
          "52998224725",
          "12.345.678-9",
          "01/01/1990",
          "PLANO A",
          "08/01/2022",
          "76361807000111",
          "Titular",
          "Enfermaria",
          "Rua Exemplo",
          "10",
          "",
          "Centro",
          "Cidade",
          "PR",
          "87000000",
          "123",
        ].join(";"),
      ]),
    ]);

    expect(result.rejectedCount).toBe(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      sourceKey: "B001",
      branchCode: "MATRIZ",
      rg: "12.345.678-9",
      category: "HOLDER",
      birthDate: "1990-01-01",
      inclusionDate: "2022-01-08",
    });
  });

  it("skips invoice summary rows and keeps signed item values", () => {
    const result = parseInvoiceCsvFiles([
      csvFile("MATRIZ.csv", [
        [
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
        ].join(";"),
        ";;;;CARD;Pessoa Exemplo;Pessoa Exemplo;Titular;TITULAR;;MENSALIDADE;-72,6;1013",
        ";;;;CARD2;Pessoa Exemplo;Pessoa Exemplo;Titular;TITULAR;;CARTEIRINHA;82,5",
        ";;;;CARD3;Pessoa Exemplo;Pessoa Exemplo;Titular;TITULAR;;NOVO EVENTO;10,00;1013;COLUNA EXTRA",
        ";;;;;;;;;;TOTAL;100,00;",
      ]),
    ]);

    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.amount)).toEqual([-72.6, 82.5, 10]);
    expect(result.rows.map((row) => row.itemDescription)).toEqual([
      "MENSALIDADE",
      "CARTEIRINHA",
      "NOVO EVENTO",
    ]);
    expect(result.rejectedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("finds the address header and normalizes address identifiers", () => {
    const result = parseAddressRows("enderecos.xlsx", [
      ["Relatório"],
      [
        "CADASTRO",
        "NOME",
        "CPF",
        "ENDEREÇO",
        "N",
        "BAIRRO",
        "CEP",
        "CIDADE",
        "UF",
        "PIS",
      ],
      [
        "10",
        "Pessoa Exemplo",
        "529.982.247-25",
        "Rua Exemplo",
        "10",
        "Centro",
        "87000-000",
        "Cidade",
        "PR",
        "123.456",
      ],
    ]);

    expect(result.rows[0]).toMatchObject({
      cpf: "52998224725",
      postalCode: "87000000",
      pis: "123456",
    });
  });

  it("rejects empty sources so a partial import cannot erase active data", () => {
    expect(() =>
      parseBeneficiaryCsvFiles([
        csvFile("MATRIZ.csv", [
          "CODIGO;NOME;MATRICULA;CATEGORIA;CPF;DATA DE NASCIMENTO;PLANO;DATA DE INCLUSAO;CNPJ",
        ]),
      ]),
    ).toThrow(/nenhum registro válido.*fonte anterior foi preservada/i);

    expect(() =>
      parseInvoiceCsvFiles([
        csvFile("MATRIZ.csv", [
          "CONTRATO;MATRICULA;CPF;CARTAO;BENEFICIARIO;TITULAR;CATEGORIA;ITEM;VALOR;PLANO",
        ]),
      ]),
    ).toThrow(/nenhum registro válido.*fonte anterior foi preservada/i);

    expect(() =>
      parseAddressRows("enderecos.xlsx", [
        [
          "CADASTRO",
          "NOME",
          "CPF",
          "ENDEREÇO",
          "N",
          "BAIRRO",
          "CEP",
          "CIDADE",
          "UF",
          "PIS",
        ],
      ]),
    ).toThrow(/não possui registros válidos.*fonte anterior foi preservada/i);
  });

  it.each(["N", "No.", "Nº", "N°", "Número"])(
    "accepts the address number header %s",
    (numberHeader) => {
      const result = parseAddressRows("enderecos.xlsx", [
        [
          "Cadastro",
          "Nome",
          "CPF",
          "Endereço",
          numberHeader,
          "Bairro",
          "Cep",
          "Cidade",
          "UF",
          "PIS",
        ],
        ["10", "Pessoa", "", "Rua", "42", "Centro", "", "Cidade", "PR", ""],
      ]);

      expect(result.rows[0].number).toBe("42");
    },
  );

  it("identifies invoice CSVs selected in the beneficiary field", () => {
    expect(() =>
      parseBeneficiaryCsvFiles([
        csvFile("ANCHIETA.csv", [
          "CONTRATO;MATRICULA;CPF;CARTAO;BENEFICIARIO;TITULAR;CATEGORIA;ITEM;VALOR;PLANO",
        ]),
      ]),
    ).toThrow(
      /Arquivos de beneficiários:.*ANCHIETA\.csv.*NOME.*DATA DE NASCIMENTO.*campos corretos/,
    );
  });

  it("identifies beneficiary CSVs selected in the invoice field", () => {
    expect(() =>
      parseInvoiceCsvFiles([
        csvFile("MATRIZ.csv", [
          "CODIGO;NOME;MATRICULA;CATEGORIA;CPF;DATA DE NASCIMENTO;PLANO;DATA DE INCLUSAO;CNPJ",
        ]),
      ]),
    ).toThrow(
      /Arquivos de faturas:.*MATRIZ\.csv.*CONTRATO.*CARTAO.*campos corretos/,
    );
  });

  it("reports malformed CSVs with their group and file", () => {
    expect(() =>
      parseInvoiceCsvFiles([
        csvFile("MATRIZ.csv", ['CONTRATO;"valor sem fechamento']),
      ]),
    ).toThrow(
      /Arquivos de faturas:.*MATRIZ\.csv.*separado por ponto e vírgula/,
    );
  });

  it("normalizes the raw Planilha1 payroll loan contract", () => {
    const header = [
      "ifConcessora.codigo",
      "ifConcessora.descricao",
      "contrato",
      "cpf",
      "matricula",
      "nomeTrabalhador",
      "dataInicioContrato",
      "dataFimContrato",
      "competenciaInicioDesconto",
      "competenciaFimDesconto",
      "totalParcelas",
      "valorParcela",
      "valorEmprestimo",
      "valorLiberado",
      "competencia",
      "numeroInscricaoEstabelecimento",
    ];
    const result = parsePayrollLoanRows(
      "consignado.xlsx",
      "Planilha1",
      [
        header,
        [
          341,
          "BANCO TESTE",
          "CTR-001",
          "52998224725",
          "00000000000000004689",
          "JOAO VICTOR",
          "01/08/2026",
          "01/07/2027",
          "08/2026",
          "07/2027",
          12,
          123.456,
          1481.47,
          1400,
          "08/2026",
          "76361807000111",
        ],
      ],
      { year: 2026, month: 8 },
    );

    expect(result.rejectedCount).toBe(0);
    expect(result.sourceSheet).toBe("Planilha1");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      competence: "2026-08",
      cpfNormalized: "52998224725",
      registration: "00000000000000004689",
      contractNumber: "CTR-001",
      installmentAmount: 123.46,
      startCompetence: "2026-08",
      endCompetence: "2027-07",
      bankCode: "341",
      bankName: "BANCO TESTE",
    });
  });

  it("normalizes the summarized GERAL layout and skips placeholders", () => {
    const result = parsePayrollLoanRows(
      "CONSIGNADO DIGITAL AGOSTO 2026.xlsx",
      "GERAL",
      [
        ["CONSIGNADO DIGITAL AGOSTO 2026"],
        [
          "CNPJ",
          "Nome",
          "CPF",
          "Valor",
          "Parcela",
          "Data Inicio",
          "Data Fim",
          "Competência",
          "Empréstimo",
          "Liberado",
          "Código",
          "Descrição",
          "Contrato",
        ],
        ["MATRIZ", null, 52998224725],
        [
          "MATRIZ",
          "JOAO VICTOR",
          52998224725,
          600,
          15,
          new Date("2026-01-08T00:00:00.000Z"),
          new Date("2027-05-25T00:00:00.000Z"),
          new Date("2026-02-01T00:00:00.000Z"),
          5747.28,
          5059.19,
          null,
          "BANCO TESTE",
          "00084035999350040",
        ],
      ],
      { year: 2026, month: 8 },
    );

    expect(result.rejectedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      competence: "2026-08",
      cpfNormalized: "52998224725",
      registration: null,
      contractNumber: "00084035999350040",
      installmentAmount: 600,
      totalInstallments: 15,
      startCompetence: "2026-02",
      endCompetence: "2027-04",
      bankCode: "NAO_INFORMADO",
      bankName: "BANCO TESTE",
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DERIVED_PAYROLL_LOAN_END_COMPETENCE",
        }),
      ]),
    );
  });

  it("rejects unsafe GERAL layouts and a competence mismatch", () => {
    expect(() =>
      parsePayrollLoanRows(
        "final.xlsx",
        "GERAL",
        [["CPF", "CONTRATO", "VALORPARCELA"]],
        { year: 2026, month: 8 },
      ),
    ).toThrow(/arquivo bruto.*Planilha1/i);

    const headers = [
      "ifConcessora.codigo",
      "ifConcessora.descricao",
      "contrato",
      "cpf",
      "matricula",
      "nomeTrabalhador",
      "competenciaInicioDesconto",
      "competenciaFimDesconto",
      "totalParcelas",
      "valorParcela",
      "competencia",
    ];
    const result = parsePayrollLoanRows(
      "consignado.xlsx",
      "Planilha1",
      [
        headers,
        [
          341,
          "BANCO",
          "CTR-002",
          "52998224725",
          "0001",
          "JOAO",
          "08/2026",
          "07/2027",
          12,
          100,
          "07/2026",
        ],
      ],
      { year: 2026, month: 8 },
    );
    expect(result.rows).toHaveLength(0);
    expect(result.rejectedCount).toBe(1);
    expect(result.diagnostics[0].code).toBe("INVALID_PAYROLL_LOAN_ROW");
  });
});
