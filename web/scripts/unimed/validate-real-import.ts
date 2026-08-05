import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";
import {
  parseAddressRows,
  parseBeneficiaryCsvFiles,
  parseInvoiceCsvFiles,
  type UnimedImportFile,
} from "../../src/lib/unimed/importer";
import { reconcileUnimedSources } from "../../src/lib/unimed/reconcile";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function csvFiles(directory: string): Promise<UnimedImportFile[]> {
  const names = (await readdir(directory))
    .filter((name) => name.toLowerCase().endsWith(".csv"))
    .sort((a, b) => a.localeCompare(b));
  return Promise.all(
    names.map(async (name) => ({ name, bytes: await readFile(path.join(directory, name)) })),
  );
}

function normalizedHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.º°\s]/g, "")
    .toUpperCase();
}

async function main() {
  const [beneficiaryDirectory, invoiceDirectory, addressPath] = process.argv.slice(2);
  assert(
    beneficiaryDirectory && invoiceDirectory && addressPath,
    "Uso: tsx validate-real-import.ts <beneficiarios> <faturas> <enderecos.xlsx>",
  );

  const [beneficiaryFiles, invoiceFiles, addressBytes] = await Promise.all([
    csvFiles(beneficiaryDirectory),
    csvFiles(invoiceDirectory),
    readFile(addressPath),
  ]);
  const workbook = await readXlsxFile(addressBytes);
  const workbookRows = workbook[0]?.data;
  assert(workbookRows, "Leitor XLSX não retornou a primeira planilha.");
  const beneficiaries = parseBeneficiaryCsvFiles(beneficiaryFiles);
  const invoices = parseInvoiceCsvFiles(invoiceFiles);
  const addresses = parseAddressRows(path.basename(addressPath), workbookRows);
  const result = reconcileUnimedSources(
    beneficiaries.rows,
    invoices.rows,
    addresses.rows,
  );

  const headerIndex = workbookRows.findIndex((row) =>
    row.some((value) => normalizedHeader(value) === "CADASTRO"),
  );
  assert(headerIndex >= 0, "Cabeçalho de endereço não localizado.");
  const numberIndex = workbookRows[headerIndex].findIndex((value) =>
    ["N", "NO", "NUMERO"].includes(normalizedHeader(value)),
  );
  assert(numberIndex >= 0, "Coluna de número não localizada.");

  for (const alias of ["N", "No.", "Nº", "N°", "Número"]) {
    const variant = workbookRows.map((row) => [...row]);
    variant[headerIndex][numberIndex] = alias;
    const parsed = parseAddressRows(`enderecos-${alias}.xlsx`, variant);
    assert(
      parsed.rows.length === addresses.rows.length &&
        parsed.rows.every((row, index) => row.number === addresses.rows[index].number),
      `Cabeçalho ${alias} alterou dados de endereço.`,
    );
  }

  const expectedInvoices = Number(process.env.EXPECT_UNMATCHED_INVOICES);
  const expectedDependents = Number(process.env.EXPECT_UNMATCHED_DEPENDENTS);
  const expectedAmbiguous = Number(process.env.EXPECT_AMBIGUOUS_PLANS);
  if (Number.isInteger(expectedInvoices)) {
    assert(
      result.warnings.unmatchedInvoiceItems === expectedInvoices,
      `Faturas sem vínculo: ${result.warnings.unmatchedInvoiceItems}; esperado ${expectedInvoices}.`,
    );
  }
  if (Number.isInteger(expectedDependents)) {
    assert(
      result.warnings.unmatchedDependents === expectedDependents,
      `Dependentes sem vínculo: ${result.warnings.unmatchedDependents}; esperado ${expectedDependents}.`,
    );
  }
  if (Number.isInteger(expectedAmbiguous)) {
    assert(
      result.warnings.ambiguousPlanCodes === expectedAmbiguous,
      `Planos ambíguos: ${result.warnings.ambiguousPlanCodes}; esperado ${expectedAmbiguous}.`,
    );
  }

  const reasonCounts = result.warningDetails.unmatchedInvoiceItems.reduce<
    Record<string, number>
  >((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
    return counts;
  }, {});
  console.log(
    JSON.stringify({
      files: {
        beneficiaries: beneficiaryFiles.length,
        invoices: invoiceFiles.length,
        addresses: 1,
      },
      rows: {
        beneficiaries: beneficiaries.rows.length,
        invoices: invoices.rows.length,
        addresses: addresses.rows.length,
      },
      warnings: result.warnings,
      unmatchedInvoiceReasons: reasonCounts,
      addressHeaderAliases: 5,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
