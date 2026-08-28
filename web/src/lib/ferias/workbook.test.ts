import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
	parseFeriasWorkbook,
	writeFeriasWorkbook,
	FeriasWorkbookError,
} from "./workbook";
import {
	children,
	elements,
	OFFICE_REL_NS,
	REL_NS,
	serialize,
	SHEET_NS,
} from "./xml";

const TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
const PRINTER_TYPE =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings";
const textCell = (ref: string, text: string, style = 0) =>
	`<c r="${ref}" s="${style}" t="inlineStr"><is><t>${text}</t></is></c>`;
function employee(row: number, period = "03/08/2026 à 01/09/2026") {
	return `<row r="${row}" ht="15.75" customHeight="1">${textCell(`A${row}`, String(row - 3))}${textCell(`B${row}`, "P")}${textCell(`C${row}`, String(10000 + row))}${textCell(`D${row}`, `Colaborador Exemplo ${row}`)}${textCell(`E${row}`, period)}${textCell(`F${row}`, "antigo")}${textCell(`G${row}`, "Mens.: 999,99")}${textCell(`H${row}`, "legado")}${textCell(`I${row}`, "Consig.R$ 999,99")}</row>`;
}

function fixture(rows = employee(4) + employee(5, "04/08/2026 à 02/09/2026")) {
	const parts: Record<string, string | Uint8Array> = {
		"[Content_Types].xml": `<Types xmlns="${TYPES}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bin" ContentType="${PRINTER_TYPE}"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
		"_rels/.rels": `<Relationships xmlns="${REL_NS}"><Relationship Id="r1" Type="${OFFICE_REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		"xl/workbook.xml": `<workbook xmlns="${SHEET_NS}" xmlns:r="${OFFICE_REL_NS}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Plan1" sheetId="1" r:id="r1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">Plan1!$A$1:$H$85</definedName></definedNames></workbook>`,
		"xl/_rels/workbook.xml.rels": `<Relationships xmlns="${REL_NS}"><Relationship Id="r1" Type="${OFFICE_REL_NS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Type="${OFFICE_REL_NS}/styles" Target="styles.xml"/></Relationships>`,
		"xl/styles.xml": `<styleSheet xmlns="${SHEET_NS}"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><sz val="11"/><name val="Arial"/><b/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
		"xl/worksheets/sheet1.xml": `<worksheet xmlns="${SHEET_NS}" xmlns:r="${OFFICE_REL_NS}"><dimension ref="A1:E85"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15.75"/><cols><col min="1" max="1" width="3.7109375" customWidth="1"/><col min="2" max="2" width="5.7109375" customWidth="1"/><col min="3" max="3" width="5.85546875" customWidth="1"/><col min="4" max="4" width="41.42578125" customWidth="1"/><col min="5" max="5" width="22.5703125" customWidth="1"/></cols><sheetData><row r="1">${textCell("A1", "FÉRIAS - AGOSTO / 2026", 1)}</row><row r="2">${textCell("A2", "Relatório de exemplo", 1)}</row><row r="3">${["Nº", "FILIAL", "CÓD.", "NOME", "PERÍODO DE GOZO"].map((v, i) => textCell(`${String.fromCharCode(65 + i)}3`, v, 1)).join("")}</row>${rows}<row r="2000">${textCell("A2000", "999")}${textCell("G2000", "Mens.: 999,99")}${textCell("H2000", "legado")}${textCell("I2000", "Consig.R$ 999,99")}</row></sheetData><mergeCells count="2"><mergeCell ref="A1:E1"/><mergeCell ref="A2:E2"/></mergeCells><pageMargins left="0.25" right="0.25" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" scale="76" fitToHeight="3" r:id="print"/></worksheet>`,
		"xl/worksheets/_rels/sheet1.xml.rels": `<Relationships xmlns="${REL_NS}"><Relationship Id="print" Type="${OFFICE_REL_NS}/printerSettings" Target="../printerSettings/printerSettings1.bin"/></Relationships>`,
		"xl/printerSettings/printerSettings1.bin": new Uint8Array([0, 1, 4, 5]),
		"docProps/custom.xml": `<Properties xmlns="urn:test"><value>Preserve exactly</value></Properties>`,
	};
	return Object.fromEntries(
		Object.entries(parts).map(([name, value]) => [
			name,
			typeof value === "string" ? strToU8(value) : value,
		]),
	);
}
const pack = (entries: Record<string, Uint8Array>) =>
	Buffer.from(zipSync(entries, { level: 6 }));
const xml = (entry: Uint8Array) =>
	new DOMParser().parseFromString(
		Buffer.from(entry).toString("utf8"),
		"application/xml",
	);
function replace(
	entries: Record<string, Uint8Array>,
	path: string,
	before: string,
	after: string,
) {
	entries[path] = strToU8(
		Buffer.from(entries[path]).toString("utf8").replace(before, after),
	);
}
const makeResults = async (buffer: Buffer) =>
	(await parseFeriasWorkbook(buffer)).rows.map((row) => ({
		row: row.row,
		days: row.days,
		highlight: row.highlight,
		unimedText: "Mens.: 61,26 + Adit.: 6,12",
		loanText: "Consig.R$ 100,00",
	}));

describe("Ferias workbook", () => {
	it("parses input without executing formulas or changing dates", async () => {
		const result = await parseFeriasWorkbook(pack(fixture()));
		expect(result.competency).toBe("2026-08");
		expect(result.rows).toEqual([
			{
				row: 4,
				registration: "10004",
				branch: "P",
				name: "Colaborador Exemplo 4",
				start: "2026-08-03",
				end: "2026-09-01",
				days: 30,
				highlight: false,
			},
			{
				row: 5,
				registration: "10005",
				branch: "P",
				name: "Colaborador Exemplo 5",
				start: "2026-08-04",
				end: "2026-09-02",
				days: 30,
				highlight: true,
			},
		]);
	});

	it("accepts the acute-accent period separator used by the production workbook", async () => {
		const entries = fixture(employee(4, "01/09/2026 á 30/09/2026"));
		replace(entries, "xl/worksheets/sheet1.xml", "AGOSTO", "SETEMBRO");
		const result = await parseFeriasWorkbook(pack(entries));
		expect(result.competency).toBe("2026-09");
		expect(result.rows[0]).toMatchObject({ start: "2026-09-01", end: "2026-09-30", days: 30 });
	});

	it("preserves other package parts byte-for-byte and all layout metadata", async () => {
		const entries = fixture();
		const buffer = pack(entries);
		const output = unzipSync(
			await writeFeriasWorkbook(buffer, await makeResults(buffer)),
		);
		expect(Object.keys(output)).toEqual(Object.keys(entries));
		for (const name of Object.keys(entries)) {
			if (!["xl/worksheets/sheet1.xml", "xl/styles.xml"].includes(name))
				expect(output[name]).toEqual(entries[name]);
		}
		const before = xml(entries["xl/worksheets/sheet1.xml"]);
		const after = xml(output["xl/worksheets/sheet1.xml"]);
		for (const name of [
			"mergeCells",
			"pageSetup",
			"pageMargins",
			"sheetViews",
			"sheetFormatPr",
		]) {
			expect(elements(after, name).map(serialize)).toEqual(
				elements(before, name).map(serialize),
			);
		}
		expect(elements(after, "dimension")[0]?.getAttribute("ref")).toBe("A1:H2000");
		const outputWidths = new Map(
			elements(after, "col").map((column) => [
				Number(column.getAttribute("min")),
				column.getAttribute("width"),
			]),
		);
		expect(outputWidths.get(6)).toBe("7");
		expect(outputWidths.get(7)).toBe("25.28515625");
		expect(outputWidths.get(8)).toBe("17.42578125");
		expect(outputWidths.has(9)).toBe(false);

		for (const original of elements(before, "c").filter((c) =>
			/^[A-E]\d+$/.test(c.getAttribute("r") ?? ""),
		)) {
			const cell = elements(after, "c").find(
				(c) => c.getAttribute("r") === original.getAttribute("r"),
			);
			expect(cell).toBeDefined();
			cell?.removeAttribute("s");
			original.removeAttribute("s");
			if (!cell) throw new Error("An original input cell disappeared");
			expect(serialize(cell)).toBe(serialize(original));
		}
		const values = new Map(
			elements(after, "c").map((c) => [
				c.getAttribute("r"),
				children(c, "is")[0]?.textContent ?? "",
			]),
		);
		expect(values.get("F4")).toBe("");
		expect(values.get("F5")).toBe("30 dias");
		expect(values.get("G4")).toBe("Mens.: 61,26 + Adit.: 6,12");
		expect(values.get("H4")).toBe("Consig.R$ 100,00");
		expect(values.has("I4")).toBe(false);
		expect(values.get("G2000")).toBe("");
		expect(values.get("H2000")).toBe("");
		expect(values.has("I2000")).toBe(false);
		const styles = xml(output["xl/styles.xml"]);
		for (const rowNumber of [4, 5]) {
			for (const col of ["F", "G", "H"]) {
				const c = elements(after, "c").find(
					(c) => c.getAttribute("r") === `${col}${rowNumber}`,
				);
				if (!c) throw new Error("An output cell disappeared");
				const xf = children(elements(styles, "cellXfs")[0], "xf")[
					Number(c.getAttribute("s"))
				];
				const font = elements(styles, "font")[
					Number(xf.getAttribute("fontId"))
				];
				expect(children(font, "b").length > 0).toBe(rowNumber === 5);
				const border = elements(styles, "border")[
					Number(xf.getAttribute("borderId"))
				];
				for (const side of ["left", "right", "top", "bottom"])
					expect(children(border, side)[0].getAttribute("style")).toBe("thin");
			}
		}
		const once = pack(output);
		const twice = unzipSync(
			await writeFeriasWorkbook(once, await makeResults(once)),
		);
		expect(twice["xl/styles.xml"]).toEqual(output["xl/styles.xml"]);
		expect(twice["xl/worksheets/sheet1.xml"]).toEqual(
			output["xl/worksheets/sheet1.xml"],
		);
	});

	it("keeps output as literal strings and blanks absent benefits", async () => {
		const buffer = pack(fixture());
		const results = await makeResults(buffer);
		results[0].unimedText = "";
		results[0].loanText = "";
		results[1].loanText = "=not_a_formula & <literal>";
		const output = unzipSync(await writeFeriasWorkbook(buffer, results));
		const doc = xml(output["xl/worksheets/sheet1.xml"]);
		expect(elements(doc, "f")).toHaveLength(0);
		expect(
			elements(doc, "c").find((c) => c.getAttribute("r") === "G4")?.textContent,
		).toBe("");
		expect(
			elements(doc, "c").find((c) => c.getAttribute("r") === "H5")?.textContent,
		).toBe(results[1].loanText);
		expect(
			elements(doc, "c").find((c) => c.getAttribute("r") === "H4")?.textContent,
		).toBe("");
		expect(elements(doc, "c").some((c) => /^I\d+$/.test(c.getAttribute("r") ?? ""))).toBe(false);
	});

	it.each([false, true])("writes loans in H without a redundant I column (grouped columns: %s)", async (grouped) => {
		const entries = fixture();
		const source = xml(entries["xl/worksheets/sheet1.xml"]);
		for (const row of elements(source, "row")) row.setAttribute("spans", "1:9");
		const cols = elements(source, "cols")[0];
		for (const [min, max, width] of grouped
			? [[6, 9, "2.5"]] as const
			: [[6, 6, "7"], [7, 7, "25.28515625"], [8, 8, "2.5"], [9, 9, "17.42578125"]] as const) {
			const column = source.createElementNS(SHEET_NS, "col");
			for (const [key, value] of Object.entries({ min, max, width, style: "1", hidden: "0", customWidth: "1" }))
				column.setAttribute(key, String(value));
			cols.appendChild(column);
		}
		entries["xl/worksheets/sheet1.xml"] = strToU8(serialize(source));
		const buffer = pack(entries);
		const output = unzipSync(await writeFeriasWorkbook(buffer, await makeResults(buffer)));
		const sheet = xml(output["xl/worksheets/sheet1.xml"]);
		expect(output["xl/workbook.xml"]).toEqual(entries["xl/workbook.xml"]);
		expect(elements(sheet, "dimension")[0].getAttribute("ref")).toBe("A1:H2000");
		expect(elements(sheet, "c").some((cell) => /^I\d+$/.test(cell.getAttribute("r") ?? ""))).toBe(false);
		for (const row of elements(sheet, "row").filter((row) => Number(row.getAttribute("r")) >= 4))
			expect(row.getAttribute("spans")).toBe("1:8");
		const columns = elements(sheet, "col");
		expect(columns).toHaveLength(8);
		for (let number = 6; number <= 8; number++) {
			const matching = columns.filter((column) => Number(column.getAttribute("min")) <= number && Number(column.getAttribute("max")) >= number);
			expect(matching).toHaveLength(1);
			expect(matching[0].getAttribute("style")).toBe("1");
			expect(matching[0].getAttribute("hidden")).toBe("0");
		}
		expect(columns[7].getAttribute("width")).toBe("17.42578125");
		expect(elements(sheet, "c").find((cell) => cell.getAttribute("r") === "H4")?.textContent).toBe("Consig.R$ 100,00");
		const once = pack(output);
		const twice = unzipSync(await writeFeriasWorkbook(once, await makeResults(once)));
		for (const name of Object.keys(output)) expect(twice[name]).toEqual(output[name]);
	});

	it.skipIf(!process.env.FERIAS_H_LAYOUT_SAMPLE)("exports the September sample through H and preserves its source layout", async () => {
		const sample = process.env.FERIAS_H_LAYOUT_SAMPLE;
		if (!sample) throw new Error("FERIAS_H_LAYOUT_SAMPLE must point to a server-only sample");
		const original = readFileSync(sample);
		const input = unzipSync(original);
		const parsed = await parseFeriasWorkbook(original);
		expect(parsed.competency).toBe("2026-09");
		const output = unzipSync(await writeFeriasWorkbook(original, await makeResults(original)));
		const before = xml(input["xl/worksheets/sheet1.xml"]);
		const after = xml(output["xl/worksheets/sheet1.xml"]);
		for (const name of Object.keys(input)) {
			if (!["xl/worksheets/sheet1.xml", "xl/styles.xml"].includes(name)) expect(output[name]).toEqual(input[name]);
		}
		for (const name of ["mergeCells", "pageSetup", "pageMargins", "sheetViews", "sheetFormatPr", "f"])
			expect(elements(after, name).map(serialize)).toEqual(elements(before, name).map(serialize));
		const columns = elements(after, "col");
		expect(columns.slice(0, 5).map(serialize)).toEqual(elements(before, "col").map(serialize));
		expect(columns).toHaveLength(8);
		expect(columns[7].getAttribute("width")).toBe("17.42578125");
		expect(elements(after, "dimension")[0].getAttribute("ref")).toBe("A1:H85");
		expect(elements(after, "c").some((cell) => /^I\d+$/.test(cell.getAttribute("r") ?? ""))).toBe(false);
		for (const source of elements(before, "c")) {
			const cell = elements(after, "c").find((cell) => cell.getAttribute("r") === source.getAttribute("r"));
			if (!cell) throw new Error("An original input cell disappeared");
			cell.removeAttribute("s");
			source.removeAttribute("s");
			expect(serialize(cell) === serialize(source)).toBe(true);
		}
		for (const row of parsed.rows)
			expect(elements(after, "c").find((cell) => cell.getAttribute("r") === `H${row.row}`)?.textContent).toBe("Consig.R$ 100,00");
		const once = pack(output);
		expect((await parseFeriasWorkbook(once)).rows).toEqual(parsed.rows);
		const twice = unzipSync(await writeFeriasWorkbook(once, await makeResults(once)));
		for (const name of Object.keys(output)) expect(twice[name]).toEqual(output[name]);
		expect(readFileSync(sample).equals(original)).toBe(true);
	});

	it.each([
		["invalid date", "03/08/2026 à 01/09/2026", "31/02/2026 à 10/03/2026"],
		["reversed dates", "03/08/2026 à 01/09/2026", "20/08/2026 à 10/08/2026"],
		["over 30 days", "03/08/2026 à 01/09/2026", "01/08/2026 à 31/08/2026"],
		[
			"mixed start months",
			"03/08/2026 à 01/09/2026",
			"01/09/2026 à 30/09/2026",
		],
		["missing code", "10004", ""],
		["missing employee name", "Colaborador Exemplo 4", ""],
		["wrong title", "AGOSTO / 2026", "SETEMBRO / 2026"],
		["wrong header", "PERÍODO DE GOZO", "Outra coluna"],
		["bad row number", 'r="2000"', 'r="2001"'],
		["duplicate row", '<row r="5"', '<row r="4"'],
		["unexpected column", 'r="I4"', 'r="J4"'],
	])("rejects %s", async (_label, before, after) => {
		const entries = fixture();
		replace(entries, "xl/worksheets/sheet1.xml", before, after);
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toBeInstanceOf(
			FeriasWorkbookError,
		);
	});

	it("reads shared rich strings and preserves leading zero registration", async () => {
		const entries = fixture();
		entries["xl/sharedStrings.xml"] = strToU8(
			`<sst xmlns="${SHEET_NS}"><si><r><t>Nome </t></r><r><t>Exemplo</t></r><rPh sb="0" eb="1"><t>not displayed</t></rPh></si></sst>`,
		);
		replace(
			entries,
			"xl/_rels/workbook.xml.rels",
			"</Relationships>",
			`<Relationship Id="shared" Type="${OFFICE_REL_NS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
		);
		replace(
			entries,
			"xl/worksheets/sheet1.xml",
			textCell("D4", "Colaborador Exemplo 4"),
			'<c r="D4" t="s"><v>0</v></c>',
		);
		replace(entries, "xl/worksheets/sheet1.xml", "10004", "0010004");
		const result = await parseFeriasWorkbook(pack(entries));
		expect(result.rows[0].name).toBe("Nome Exemplo");
		expect(result.rows[0].registration).toBe("0010004");
	});

	it("preserves UTF-16 custom metadata and normalizes modified UTF-16 sheet declarations", async () => {
		const entries = fixture();
		const metadata = Buffer.from(
			'\ufeff<?xml version="1.0" encoding="UTF-16"?><item>Descrição</item>',
			"utf16le",
		);
		entries["customXml/item.xml"] = metadata;
		const sheet = Buffer.from(entries["xl/worksheets/sheet1.xml"]).toString(
			"utf8",
		);
		entries["xl/worksheets/sheet1.xml"] = Buffer.from(
			`\ufeff<?xml version="1.0" encoding="UTF-16"?>${sheet}`,
			"utf16le",
		);
		const buffer = pack(entries);
		const output = unzipSync(
			await writeFeriasWorkbook(buffer, await makeResults(buffer)),
		);
		expect(output["customXml/item.xml"]).toEqual(new Uint8Array(metadata));
		expect(
			Buffer.from(output["xl/worksheets/sheet1.xml"]).toString("utf8"),
		).toContain('encoding="UTF-8"');
		expect((await parseFeriasWorkbook(pack(output))).rows).toHaveLength(2);
	});

	it("rejects formulas even in unused output cells", async () => {
		const entries = fixture();
		replace(
			entries,
			"xl/worksheets/sheet1.xml",
			textCell("G2000", "Mens.: 999,99"),
			'<c r="G2000"><f>1+1</f><v>2</v></c>',
		);
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(
			/fórmulas/,
		);
	});

	it.each([
		"HYPERLINK(&quot;https://example.com&quot;)",
		"'[external.xlsx]Plan1'!$A$1:$H$85",
		"AnotherSheet!$A$1:$H$85",
		"Plan1!$A$1:$H$2001",
		"Plan1!$A$85:$H$1",
		"Plan1!$A$1:$J$85",
	])("rejects nonliteral or invalid print areas: %s", async (area) => {
		const entries = fixture();
		replace(entries, "xl/workbook.xml", "Plan1!$A$1:$H$85", area);
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(
			/nomes calculados/,
		);
	});

	it("accepts only literal print titles and preserves their original bytes", async () => {
		const entries = fixture();
		replace(
			entries,
			"xl/workbook.xml",
			"</definedNames>",
			'<definedName name="_xlnm.Print_Titles" localSheetId="0">Plan1!$1:$3,Plan1!$A:$E</definedName></definedNames>',
		);
		const buffer = pack(entries);
		const output = unzipSync(
			await writeFeriasWorkbook(buffer, await makeResults(buffer)),
		);
		expect(output["xl/workbook.xml"]).toEqual(entries["xl/workbook.xml"]);
		replace(
			entries,
			"xl/workbook.xml",
			"Plan1!$1:$3,Plan1!$A:$E",
			"SUM(A1:A3)",
		);
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(
			/nomes calculados/,
		);
	});

	it.each(["DOCTYPE", "ENTITY"])(
		"rejects XML declarations: %s",
		async (keyword) => {
			const entries = fixture();
			entries["docProps/custom.xml"] = strToU8(`<!${keyword} sample><sample/>`);
			await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(/XML/);
		},
	);

	it("rejects malformed XML without echoing personal contents", async () => {
		const entries = fixture();
		entries["docProps/custom.xml"] = strToU8(
			"<private><employee>PRIVATE_VALUE</private>",
		);
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(
			"A estrutura XML da planilha está inválida.",
		);
	});

	it.each([
		"xl/vbaProject.bin",
		"xl/embeddings/document.bin",
		"xl/externalLinks/externalLink1.xml",
	])("rejects active package part %s", async (name) => {
		const entries = fixture();
		entries[name] = strToU8("x");
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(
			/Macros|conexões/,
		);
	});

	it.each([
		"orphan.exe",
		"xl/code.vbs",
		"customXml/script.js",
		"docProps/page.html",
		"xl/unexpected.zip",
	])("rejects unsupported embedded file %s", async (name) => {
		const entries = fixture();
		entries[name] = strToU8("test");
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(
			/anexos não permitidos/,
		);
	});

	it("verifies CRC integrity instead of silently accepting damaged ZIP data", async () => {
		const buffer = pack(fixture());
		const footer = buffer.length - 22;
		const central = buffer.readUInt32LE(footer + 16);
		buffer.writeUInt32LE(1234, central + 16);
		await expect(parseFeriasWorkbook(buffer)).rejects.toThrow(
			/integridade|ZIP/,
		);
	});

	it("rejects an external relationship regardless of target extension", async () => {
		const entries = fixture();
		replace(
			entries,
			"xl/_rels/workbook.xml.rels",
			"</Relationships>",
			`<Relationship Id="external" Type="${OFFICE_REL_NS}/hyperlink" Target="https://example.com/file.xlsx" TargetMode="External"/></Relationships>`,
		);
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(
			/externos/,
		);
	});

	it("rejects an unverified printer binary rather than allowing arbitrary bin files", async () => {
		const entries = fixture();
		replace(
			entries,
			"[Content_Types].xml",
			PRINTER_TYPE,
			"application/octet-stream",
		);
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(/binário/);
	});

	it("rejects more than 200 zip entries and more than 1000 employees", async () => {
		const entries = fixture();
		for (let i = 0; i < 201; i += 1)
			entries[`customXml/extra${i}.xml`] = strToU8("<item/>");
		await expect(parseFeriasWorkbook(pack(entries))).rejects.toThrow(
			/estrutura/,
		);
		const rows = Array.from({ length: 1001 }, (_, i) => employee(i + 4)).join(
			"",
		);
		await expect(parseFeriasWorkbook(pack(fixture(rows)))).rejects.toThrow(
			/1.000 colaboradores/,
		);
	});

	it("rejects oversized, truncated, and non-XLSX files", async () => {
		await expect(
			parseFeriasWorkbook(Buffer.alloc(5 * 1024 * 1024 + 1)),
		).rejects.toThrow(/5 MB/);
		await expect(
			parseFeriasWorkbook(Buffer.from("not a workbook")),
		).rejects.toBeInstanceOf(FeriasWorkbookError);
		const valid = pack(fixture());
		await expect(
			parseFeriasWorkbook(valid.subarray(0, valid.length - 20)),
		).rejects.toBeInstanceOf(FeriasWorkbookError);
	});

	it("rejects incomplete, duplicated or stale export results", async () => {
		const buffer = pack(fixture());
		const results = await makeResults(buffer);
		await expect(writeFeriasWorkbook(buffer, results.slice(1))).rejects.toThrow(
			/todos/,
		);
		await expect(
			writeFeriasWorkbook(buffer, [results[0], results[0]]),
		).rejects.toThrow(/duplicadas/);
		await expect(
			writeFeriasWorkbook(buffer, [{ ...results[0], days: 15 }, results[1]]),
		).rejects.toThrow(/mudaram/);
	});

	it.skipIf(!process.env.FERIAS_LAYOUT_SAMPLE)(
		"rejects the original inverted range, then proves layout fidelity on a controlled in-memory correction",
		async () => {
			const sample = process.env.FERIAS_LAYOUT_SAMPLE;
			if (!sample)
				throw new Error(
					"FERIAS_LAYOUT_SAMPLE must point to a server-only sample",
				);
			const original = readFileSync(sample);
			await expect(parseFeriasWorkbook(original)).rejects.toThrow(
				/Linha 22: O período/,
			);
			const input = unzipSync(original);
			const corrected = xml(input["xl/worksheets/sheet1.xml"]);
			const period = elements(corrected, "c").find(
				(c) => c.getAttribute("r") === "E22",
			);
			if (!period) throw new Error("The known invalid source row is missing");
			while (period.firstChild) period.removeChild(period.firstChild);
			period.setAttribute("t", "inlineStr");
			const inline = corrected.createElementNS(SHEET_NS, "is");
			const value = corrected.createElementNS(SHEET_NS, "t");
			value.appendChild(corrected.createTextNode("13/08/2026 à 11/09/2026"));
			inline.appendChild(value);
			period.appendChild(inline);
			input["xl/worksheets/sheet1.xml"] = strToU8(serialize(corrected));
			const buffer = pack(input);
			const parsed = await parseFeriasWorkbook(buffer);
			expect(parsed.rows.length).toBeGreaterThan(0);
			const output = unzipSync(
				await writeFeriasWorkbook(buffer, await makeResults(buffer)),
			);
			for (const name of Object.keys(input)) {
				if (!["xl/worksheets/sheet1.xml", "xl/styles.xml"].includes(name))
					expect(
						Buffer.from(output[name]).equals(Buffer.from(input[name])),
					).toBe(true);
			}
			const before = xml(input["xl/worksheets/sheet1.xml"]);
			const after = xml(output["xl/worksheets/sheet1.xml"]);
			for (const name of [
				"dimension",
				"cols",
				"mergeCells",
				"pageSetup",
				"pageMargins",
				"sheetViews",
				"sheetFormatPr",
			])
				expect(elements(after, name).map(serialize)).toEqual(
					elements(before, name).map(serialize),
				);
			for (const original of elements(before, "c").filter((c) =>
				/^[A-E]\d+$/.test(c.getAttribute("r") ?? ""),
			)) {
				const cell = elements(after, "c").find(
					(c) => c.getAttribute("r") === original.getAttribute("r"),
				);
				if (!cell) throw new Error("An original input cell disappeared");
				cell.removeAttribute("s");
				original.removeAttribute("s");
				expect(serialize(cell) === serialize(original)).toBe(true);
			}
			expect(
				JSON.stringify((await parseFeriasWorkbook(pack(output))).rows) ===
					JSON.stringify(parsed.rows),
			).toBe(true);
			expect(readFileSync(sample).equals(original)).toBe(true);
		},
	);
});
