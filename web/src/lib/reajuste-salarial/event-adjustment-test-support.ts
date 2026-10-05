import { zipSync, strToU8 } from "fflate";

function eventWorkbook(sundayPaid = "170,00", registration = "1") {
  const rows = [
    ["0001", "EMPRESA TESTE", "Pág.:", "1"], ["FOLHA DE PAGAMENTO"], ["Local:", "01 MATRIZ"],
    ["Tipo:", "1", "Colaborador:", `${registration} - ANA TESTE`],
    ["565", "01", "Bonus Convenc. SINDECOMU", "", "1,00", "80,00"],
    ["901", "01", "Indenização Compensatória", "", "0,00", sundayPaid],
    ["INSS Proc:", "2.000,00"],
    ["565", "01", "Resumo", "", "1,00", "80,00"],
  ];
  const xml = rows.map((row, i) => `<row r="${i + 1}">${row.map((cell, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${cell}</t></is></c>`).join("")}</row>`).join("");
  return zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plan1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`),
  });
}

export async function presenceEventRequest(excludeAbsentLatest = "true") {
  const form = await eventRequest({ excludeAbsentLatest }).formData();
  form.append("files", new File([new Uint8Array(eventWorkbook("255,00", "2"))], "07-2026.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return new Request("http://localhost/api/reajuste-salarial/eventos", { method: "POST", body: form, headers: { "content-length": "8192", origin: "http://localhost" } });
}

export function eventRequest(overrides: Record<string, string> = {}, sundayPaid?: string, duplicate = false) {
  const form = new FormData();
  form.append("files", new File([new Uint8Array(eventWorkbook(sundayPaid))], "06-2026.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  if (duplicate) form.append("files", new File([new Uint8Array(eventWorkbook())], "06-2026.xlsx"));
  for (const [key, value] of Object.entries({ bonusOldValue: "80,00", bonusNewValue: "90,00", sundayOldValue: "85,00", sundayNewValue: "90,00", ...overrides })) form.set(key, value);
  return new Request("http://localhost/api/reajuste-salarial/eventos", { method: "POST", body: form, headers: { "content-length": "4096", origin: "http://localhost" } });
}
