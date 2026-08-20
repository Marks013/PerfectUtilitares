import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedBeneficiary: {
      findFirst: mocks.findFirst,
    },
  },
}));

import {
  buildUnimedDocumentValues,
  generateUnimedDocument,
  renderUnimedDocumentTemplate,
  UnimedDocumentError,
} from "@/lib/unimed/documents";

const rn561Fields = [
  "Razão_social",
  "ENDEREÇO",
  "Numero",
  "Bairro",
  "Cidade",
  "UF",
  "CNPJ",
  "Inscrição_Estadual",
  "Telefone",
  "NOME",
  "CPF",
  "DEPENDENTE1",
  "CPF1",
  "DEPENDENTE2",
  "CPF2",
  "DEPENDENTE3",
  "CPF3",
  "DEPENDENTE4",
  "CPF4",
  "DEPENDENTE5",
  "CPF5",
  "DEPENDENTE6",
  "CPF6",
];

function complexMergeField(field: string) {
  return [
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
    `<w:r><w:instrText> MERGEFIELD &quot;${field}&quot; </w:instrText></w:r>`,
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    `<w:r><w:t>OLD_${field}</w:t></w:r>`,
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
  ].join("");
}

async function syntheticTemplate(fields = rn561Fields) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  );
  zip.file(
    "word/document.xml",
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      "<w:body><w:tbl><w:tr><w:tc><w:p>",
      ...fields.map(complexMergeField),
      "</w:p></w:tc></w:tr></w:tbl></w:body></w:document>",
    ].join(""),
  );
  zip.file(
    "word/settings.xml",
    '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:mailMerge><w:mainDocumentType w:val="formLetters"/></w:mailMerge></w:settings>',
  );
  zip.file(
    "word/_rels/settings.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/mailMergeSource" Target="source.xlsx" TargetMode="External"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme.xml"/></Relationships>',
  );
  zip.file("word/header1.xml", "<w:hdr>LAYOUT_HEADER</w:hdr>");
  zip.file("word/media/image1.png", Uint8Array.from([1, 2, 3, 4, 5]));
  return zip.generateAsync({ type: "nodebuffer" });
}

function requireZipFile(zip: JSZip, fileName: string) {
  const file = zip.file(fileName);

  if (!file) {
    throw new Error(`Arquivo esperado não encontrado no ZIP: ${fileName}`);
  }

  return file;
}

function beneficiary(
  overrides: Partial<Parameters<typeof buildUnimedDocumentValues>[0]> = {},
) {
  return {
    fullName: "Pessoa Titular Teste",
    cpf: "52998224725",
    rg: "12.345.678-9",
    category: "HOLDER" as const,
    holder: null,
    dependents: [],
    address: {
      addressLine: "Rua de Teste",
      number: "100",
      postalCode: "12345-000",
      city: "Cidade Teste",
      state: "SP",
    },
    branch: {
      name: "Filial Teste",
      companyName: "Empresa Teste",
      cnpj: "11222333000181",
      addressLine: "Avenida de Teste",
      number: "500",
      district: "Centro",
      city: "Cidade Teste",
      state: "SP",
      stateRegistration: "123.456.789.000",
      phone: "11-3456-7890",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Unimed DOCX documents", () => {
  it("keeps the complete deterministic RN561 DATA placeholder", async () => {
    const template = await readFile(
      path.resolve(
        process.cwd(),
        "scripts/unimed/templates/MODELO_RN561_FORMULARIO _EXCLUSAO.docx",
      ),
    );
    const zip = await JSZip.loadAsync(template, { checkCRC32: true });
    const documentXml = await requireZipFile(zip, "word/document.xml").async("string");
    const dateParagraph = [
      ...documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g),
    ].find((match) => match[0].includes("<w:t>DATA</w:t>"))?.[0];

    expect(dateParagraph).toContain("______/______/________");
    expect(dateParagraph).not.toContain("<w:tab/>");
  });

  it("maps dependent exclusion to holder plus one dependent without real PII", () => {
    const result = buildUnimedDocumentValues(
      beneficiary({
        fullName: "Pessoa Dependente Teste",
        cpf: "11144477735",
        category: "DEPENDENT",
        holder: {
          fullName: "Pessoa Titular Teste",
          cpf: "52998224725",
        },
      }),
      1,
    );

    expect(result).toEqual({
      kind: "RN561",
      values: expect.objectContaining({
        NOME: "Pessoa Titular Teste",
        CPF: "529.982.247-25",
        DEPENDENTE1: "Pessoa Dependente Teste",
        CPF1: "111.444.777-35",
        CNPJ: "11.222.333/0001-81",
        Numero: "500",
        Inscrição_Estadual: "123.456.789.000",
        Telefone: "11-3456-7890",
      }),
    });
    expect(result.values.DEPENDENTE2).toBe("");
  });

  it("maps only selected holder dependents to dependent exclusion", () => {
    const result = buildUnimedDocumentValues(
      beneficiary({
        dependents: [
          { fullName: "Pessoa Dependente Um", cpf: "11144477735" },
          { fullName: "Pessoa Dependente Dois", cpf: "52998224725" },
        ],
      }),
      1,
    );

    expect(result.values).toMatchObject({
      NOME: "Pessoa Titular Teste",
      DEPENDENTE1: "Pessoa Dependente Um",
      DEPENDENTE2: "Pessoa Dependente Dois",
    });
  });

  it("maps reason 8 to inactive term with imported RG and address", () => {
    const result = buildUnimedDocumentValues(beneficiary(), 8);

    expect(result).toEqual({
      kind: "INACTIVE_TERM",
      values: {
        TITULAR: "Pessoa Titular Teste",
        CPF: "529.982.247-25",
        RG: "12.345.678-9",
        ENDEREÇO: "Rua de Teste",
        Numero: "100",
        CEP: "12345-000",
        MUNICIPIO: "Cidade Teste",
        UF: "SP",
      },
    });
  });

  it("blocks category mismatch, missing CPF and more than six dependents", () => {
    expect(() => buildUnimedDocumentValues(beneficiary(), 1)).toThrowError(
      expect.objectContaining({ code: "UNIMED_DOCUMENT_REASON_MISMATCH" }),
    );
    expect(() =>
      buildUnimedDocumentValues(beneficiary({ cpf: null }), 8),
    ).toThrowError(
      expect.objectContaining({ code: "UNIMED_DOCUMENT_CPF_REQUIRED" }),
    );
    expect(() =>
      buildUnimedDocumentValues(
        beneficiary({
          dependents: Array.from({ length: 7 }, (_, index) => ({
            fullName: `Dependente Teste ${index + 1}`,
            cpf: "11144477735",
          })),
        }),
        2,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "UNIMED_DOCUMENT_DEPENDENT_LIMIT" }),
    );
  });

  it.each([0, 1, 4, 5, 6])(
    "maps every CPF without omission for %i holder dependents",
    (dependentCount) => {
      const dependents = Array.from({ length: dependentCount }, (_, index) => ({
        fullName: `Dependente Teste ${index + 1}`,
        cpf: index % 2 === 0 ? "11144477735" : "52998224725",
      }));

      const result = buildUnimedDocumentValues(beneficiary({ dependents }), 2);

      for (let index = 0; index < 6; index += 1) {
        expect(result.values[`DEPENDENTE${index + 1}`]).toBe(
          dependents[index]?.fullName ?? "",
        );
        expect(result.values[`CPF${index + 1}`]).toBe(
          dependents[index]
            ? index % 2 === 0
              ? "111.444.777-35"
              : "529.982.247-25"
            : "",
        );
      }
    },
  );

  it("maps a manually supplied dependent into RN561 values", () => {
    const result = buildUnimedDocumentValues(
      beneficiary({
        dependents: [
          { fullName: "Dependente Manual", cpf: "11144477735" },
        ],
      }),
      1,
    );

    expect(result.values).toMatchObject({
      DEPENDENTE1: "Dependente Manual",
      CPF1: "111.444.777-35",
    });
  });

  it("replaces cached merge results, removes data links and preserves layout parts", async () => {
    const input = await syntheticTemplate();
    const values = Object.fromEntries(
      rn561Fields.map((field) => [field, `VALOR_${field}`]),
    );
    values.NOME = "Pessoa & Teste";

    const output = await renderUnimedDocumentTemplate(input, "RN561", values);
    const zip = await JSZip.loadAsync(output, { checkCRC32: true });
    const documentXml = await requireZipFile(zip, "word/document.xml").async("string");
    const settingsXml = await requireZipFile(zip, "word/settings.xml").async("string");
    const relationships = await requireZipFile(zip, "word/_rels/settings.xml.rels")
      .async("string");
    const image = await requireZipFile(zip, "word/media/image1.png").async("uint8array");

    expect(documentXml).not.toContain("OLD_");
    expect(documentXml).toContain("Pessoa &amp; Teste");
    expect(documentXml).toContain("<w:tbl>");
    expect(settingsXml).toContain('<w:zoom w:percent="100"/>');
    expect(settingsXml).not.toContain("mailMerge");
    expect(relationships).toContain("theme.xml");
    expect(relationships).not.toContain("mailMergeSource");
    expect([...image]).toEqual([1, 2, 3, 4, 5]);
    expect(await requireZipFile(zip, "word/header1.xml").async("string")).toBe(
      "<w:hdr>LAYOUT_HEADER</w:hdr>",
    );
  });

  it("blocks a template whose merge field structure differs", async () => {
    const template = await syntheticTemplate(rn561Fields.slice(0, -1));

    await expect(
      renderUnimedDocumentTemplate(template, "RN561", {}),
    ).rejects.toMatchObject({
      code: "UNIMED_DOCUMENT_TEMPLATE_INVALID",
      status: 503,
    });
  });

  it("queries beneficiary from the two retained competencies", async () => {
    mocks.findFirst.mockResolvedValue(null);

    await expect(
      generateUnimedDocument("tenant-test-123", "beneficiary-test-123", 8),
    ).rejects.toEqual(
      new UnimedDocumentError("UNIMED_DOCUMENT_BENEFICIARY_NOT_FOUND", 404),
    );
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "beneficiary-test-123",
          tenantId: "tenant-test-123",
          competency: { status: { in: ["ACTIVE", "PREVIOUS"] } },
        },
      }),
    );
  });

  it.runIf(Boolean(process.env.UNIMED_REAL_TEMPLATE_DIR))(
    "renders both verified real templates only in memory",
    async () => {
      const previousTemplateDir = process.env.UNIMED_TEMPLATE_DIR;
      const realTemplateDir = process.env.UNIMED_REAL_TEMPLATE_DIR;

      if (!realTemplateDir) {
        throw new Error("UNIMED_REAL_TEMPLATE_DIR não foi definido.");
      }

      process.env.UNIMED_TEMPLATE_DIR = path.resolve(realTemplateDir);
      mocks.findFirst.mockResolvedValue(beneficiary());

      try {
        const realCases = [
          {
            reasonCode: 2 as const,
            fileName: "MODELO_RN561_FORMULARIO _EXCLUSAO.docx",
            expectedValues: [
              "Pessoa Titular Teste",
              "Empresa Teste",
              "11.222.333/0001-81",
            ],
          },
          {
            reasonCode: 8 as const,
            fileName: "MODELO_TERMO_INATIVO.docx",
            expectedValues: [
              "Pessoa Titular Teste",
              "Rua de Teste",
              "Cidade Teste",
            ],
          },
        ];
        for (const realCase of realCases) {
          const sourceBytes = await readFile(
            path.join(process.env.UNIMED_TEMPLATE_DIR, realCase.fileName),
          );
          const sourceZip = await JSZip.loadAsync(sourceBytes, {
            checkCRC32: true,
          });
          const generated = await generateUnimedDocument(
            "tenant-test-123",
            "beneficiary-test-123",
            realCase.reasonCode,
          );
          const zip = await JSZip.loadAsync(generated.bytes, {
            checkCRC32: true,
          });
          const sourceDocumentXml = await requireZipFile(sourceZip, "word/document.xml")
            .async("string");
          const documentXml = await requireZipFile(zip, "word/document.xml")
            .async("string");
          const settingsXml = await requireZipFile(zip, "word/settings.xml")
            .async("string");
          const cpfValues = [
            ...documentXml.matchAll(/\d{3}\.\d{3}\.\d{3}-\d{2}/g),
          ].map((match) => match[0]);

          expect(generated.bytes.byteLength).toBeGreaterThan(50_000);
          for (const value of realCase.expectedValues) {
            expect(documentXml).toContain(value);
          }
          expect(new Set(cpfValues)).toEqual(new Set(["529.982.247-25"]));
          expect(settingsXml).not.toContain("mailMerge");
          expect(documentXml.match(/<w:tbl\b/g)?.length ?? 0).toBe(
            sourceDocumentXml.match(/<w:tbl\b/g)?.length ?? 0,
          );
          expect(documentXml.match(/<w:drawing\b/g)?.length ?? 0).toBe(
            sourceDocumentXml.match(/<w:drawing\b/g)?.length ?? 0,
          );

          const preservedParts = Object.keys(sourceZip.files).filter(
            (name) =>
              !sourceZip.files[name].dir &&
              (/^word\/media\//.test(name) ||
                /^word\/(?:header|footer)\d+\.xml$/.test(name)),
          );
          expect(
            Object.keys(zip.files).filter(
              (name) =>
                !zip.files[name].dir &&
                (/^word\/media\//.test(name) ||
                  /^word\/(?:header|footer)\d+\.xml$/.test(name)),
            ),
          ).toEqual(preservedParts);
          for (const partName of preservedParts) {
            expect(await requireZipFile(zip, partName).async("uint8array")).toEqual(
              await requireZipFile(sourceZip, partName).async("uint8array"),
            );
          }
        }
      } finally {
        if (previousTemplateDir === undefined) {
          delete process.env.UNIMED_TEMPLATE_DIR;
        } else {
          process.env.UNIMED_TEMPLATE_DIR = previousTemplateDir;
        }
      }
    },
    15_000,
  );
});
