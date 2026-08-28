import type { Document, Element } from "@xmldom/xmldom";
import { zipSync } from "fflate";
import { validateXlsxArchive } from "@/lib/spreadsheets/xlsx-security";
import { FeriasCalendarError, vacationHighlight } from "./calendar";
import { createStyleWriter } from "./workbook-styles";
import {
	children,
	elements,
	fail,
	type FeriasArchive,
	FeriasWorkbookError,
	hasControlCharacters,
	MAX_WORKBOOK_BYTES,
	OFFICE_REL_NS,
	openArchive,
	REL_NS,
	relationshipTarget,
	serializeUtf8,
	SHEET_NS,
	spreadsheetElement,
} from "./xml";

export { FeriasWorkbookError } from "./xml";

export type FeriasInputRow = {
	row: number;
	registration: string;
	branch: string;
	name: string;
	start: string;
	end: string;
	days: number;
	highlight: boolean;
};

type OutputRow = {
	row: number;
	highlight: boolean;
	days: number;
	unimedText: string;
	loanText: string;
};

const MONTHS = [
	"JANEIRO",
	"FEVEREIRO",
	"MARCO",
	"ABRIL",
	"MAIO",
	"JUNHO",
	"JULHO",
	"AGOSTO",
	"SETEMBRO",
	"OUTUBRO",
	"NOVEMBRO",
	"DEZEMBRO",
];

function normalized(value: string) {
	return value
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toUpperCase()
		.replace(/\s+/g, " ")
		.trim();
}

function requiredDoc(archive: FeriasArchive, name: string): Document {
	return archive.documents.get(name) ?? fail("A planilha está incompleta.");
}

function richText(item: Element): string {
	return Array.from(item.childNodes)
		.map((node) => {
			if (node.nodeType !== 1) return "";
			const child = node as Element;
			if (child.namespaceURI !== SHEET_NS) return "";
			if (child.localName === "t") return child.textContent ?? "";
			if (child.localName === "r")
				return children(child, "t")
					.map((t) => t.textContent ?? "")
					.join("");
			return "";
		})
		.join("");
}

function load(buffer: Buffer) {
	const archive = openArchive(buffer);
	const workbook = requiredDoc(archive, "xl/workbook.xml");
	const sheets = elements(workbook, "sheet");
	if (
		sheets.length !== 1 ||
		sheets[0].getAttribute("name") !== "Plan1" ||
		["hidden", "veryHidden"].includes(sheets[0].getAttribute("state") ?? "")
	) {
		fail("Envie o modelo com uma única aba visível chamada Plan1.");
	}
	const relsPath = "xl/_rels/workbook.xml.rels";
	const rels = elements(requiredDoc(archive, relsPath), "Relationship", REL_NS);
	function part(type: string, id?: string) {
		const found = rels.filter(
			(rel) =>
				rel.getAttribute("Type") === `${OFFICE_REL_NS}/${type}` &&
				(id === undefined || rel.getAttribute("Id") === id),
		);
		if (found.length !== 1)
			return fail("Os vínculos da aba e dos estilos estão incompletos.");
		return relationshipTarget(relsPath, found[0].getAttribute("Target") ?? "");
	}
	const sheetPath = part(
		"worksheet",
		sheets[0].getAttributeNS(OFFICE_REL_NS, "id") ?? "",
	);
	const stylesPath = part("styles");
	const sheet = requiredDoc(archive, sheetPath);
	const styles = requiredDoc(archive, stylesPath);
	if (
		sheet.documentElement?.localName !== "worksheet" ||
		sheet.documentElement.namespaceURI !== SHEET_NS ||
		styles.documentElement?.localName !== "styleSheet" ||
		styles.documentElement.namespaceURI !== SHEET_NS
	) {
		fail("A aba ou os estilos não possuem o formato esperado.");
	}
	if (
		elements(sheet, "sheetProtection").length ||
		elements(workbook, "workbookProtection").length
	)
		fail("Envie uma cópia da planilha sem proteção para edição.");
	const sharedRel = rels.filter(
		(rel) => rel.getAttribute("Type") === `${OFFICE_REL_NS}/sharedStrings`,
	);
	if (sharedRel.length > 1) fail("A tabela de textos da planilha é inválida.");
	const strings = sharedRel.length
		? elements(requiredDoc(archive, part("sharedStrings")), "si").map(richText)
		: [];
	const sheetData = elements(sheet, "sheetData");
	if (sheetData.length !== 1)
		fail("A planilha não contém uma área de dados válida.");
	const physicalRows = children(sheetData[0], "row");
	if (physicalRows.length > 2_000)
		fail("A planilha excede o limite de 2.000 linhas.");
	const rowNodes = new Map<number, Element>();
	const cellNodes = new Map<string, Element>();
	let previousRow = 0;
	for (const row of physicalRows) {
		const position = row.getAttribute("r") ?? "";
		const number = Number(position);
		if (!/^\d+$/.test(position) || number <= previousRow || number > 2_000)
			fail("A numeração das linhas é inválida ou excede 2.000 linhas.");
		previousRow = number;
		rowNodes.set(number, row);
		let previousColumn = 0;
		for (const cell of children(row, "c")) {
			const ref = cell.getAttribute("r") ?? "";
			const match = /^([A-I])([1-9]\d*)$/.exec(ref);
			const column = match ? match[1].charCodeAt(0) - 64 : 0;
			if (!match || Number(match[2]) !== number || column <= previousColumn)
				fail(
					`Linha ${number}: as colunas devem estar ordenadas entre A e I, sem duplicação.`,
				);
			previousColumn = column;
			cellNodes.set(ref, cell);
		}
	}
	function value(ref: string): string {
		const cell = cellNodes.get(ref);
		if (!cell) return "";
		const type = cell.getAttribute("t");
		const v = children(cell, "v")[0]?.textContent ?? "";
		if (type === "s") {
			const index = Number(v);
			if (
				!/^\d+$/.test(v) ||
				!Number.isSafeInteger(index) ||
				strings[index] === undefined
			)
				fail("A planilha contém uma referência de texto inválida.");
			return strings[index];
		}
		if (type === "inlineStr")
			return children(cell, "is").map(richText).join("");
		if (type === "e" || type === "b")
			fail(
				"A planilha contém um valor de erro ou lógico nos dados de entrada.",
			);
		return v;
	}
	return {
		...archive,
		sheet,
		sheetPath,
		styles,
		stylesPath,
		rowNodes,
		cellNodes,
		value,
	};
}

function parseRows(input: ReturnType<typeof load>) {
	const headers = ["N", "FILIAL", "COD", "NOME", "PERIODO DE GOZO"];
	for (let i = 0; i < 5; i += 1) {
		const text = normalized(
			input.value(`${String.fromCharCode(65 + i)}3`),
		).replace(/[.º°]/g, "");
		if (text !== headers[i])
			fail("Os cabeçalhos da linha 3 não correspondem ao modelo de férias.");
	}
	const rows: FeriasInputRow[] = [];
	for (const row of input.rowNodes.keys()) {
		if (row < 4) continue;
		const name = input.value(`D${row}`).trim();
		const registration = input.value(`C${row}`).trim();
		const branch = input.value(`B${row}`).trim();
		const period = input.value(`E${row}`).trim();
		if (!name && !registration && !branch && !period) continue;
		if (
			!name ||
			!branch ||
			!/^\d{1,20}$/.test(registration) ||
			name.length > 160 ||
			branch.length > 40
		)
			fail(`Linha ${row}: preencha código, filial e nome válidos.`);
		const dates =
			/^(\d{2})\/(\d{2})\/(\d{4})\s*(?:à|á|a|até|[-–])\s*(\d{2})\/(\d{2})\/(\d{4})$/i.exec(
				period,
			);
		if (!dates)
			fail(`Linha ${row}: informe o período como 01/09/2026 a 30/09/2026.`);
		const start = `${dates[3]}-${dates[2]}-${dates[1]}`;
		const end = `${dates[6]}-${dates[5]}-${dates[4]}`;
		try {
			const { days, highlight } = vacationHighlight(start, end);
			rows.push({
				row,
				registration,
				branch,
				name,
				start,
				end,
				days,
				highlight,
			});
		} catch (error) {
			if (error instanceof FeriasCalendarError)
				fail(`Linha ${row}: ${error.message}`);
			throw error;
		}
		if (rows.length > 1_000)
			fail("A planilha excede o limite de 1.000 colaboradores.");
	}
	if (!rows.length)
		fail("A planilha não contém colaboradores a partir da linha 4.");
	const competency = rows[0].start.slice(0, 7);
	if (rows.some((row) => row.start.slice(0, 7) !== competency))
		fail("Separe as férias em um arquivo para cada mês de início.");
	const title = normalized(input.value("A1"));
	const match = /^FERIAS\s*-\s*([A-Z]+)\s*\/\s*(20\d{2})$/.exec(title);
	if (
		!match ||
		MONTHS.indexOf(match[1]) + 1 !== Number(competency.slice(5)) ||
		match[2] !== competency.slice(0, 4)
	)
		fail("O mês e o ano do título devem corresponder ao início das férias.");
	return { rows, competency };
}

export async function parseFeriasWorkbook(
	buffer: Buffer,
): Promise<{ rows: FeriasInputRow[]; competency: string }> {
	return parseRows(load(buffer));
}

function setText(cell: Element, text: string) {
	for (const name of ["v", "is", "f"]) {
		for (const child of children(cell, name)) cell.removeChild(child);
	}
	if (!text) {
		cell.removeAttribute("t");
		return;
	}
	cell.setAttribute("t", "inlineStr");
	const inline = spreadsheetElement(cell, "is");
	const value = spreadsheetElement(cell, "t");
	value.setAttributeNS(
		"http://www.w3.org/XML/1998/namespace",
		"xml:space",
		"preserve",
	);
	const document = cell.ownerDocument;
	if (!document) fail("A estrutura da célula está incompleta.");
	value.appendChild(document.createTextNode(text));
	inline.appendChild(value);
	cell.insertBefore(inline, children(cell, "extLst")[0] ?? null);
}

const OUTPUT_COLUMN_WIDTHS: ReadonlyArray<readonly [number, string]> = [
	[6, "7"],
	[7, "25.28515625"],
	[8, "17.42578125"],
];

function ensureOutputLayout(
	sheet: Document,
	rowNodes: Map<number, Element>,
) {
	const root = sheet.documentElement ?? fail("A estrutura da aba está incompleta.");
	let cols = children(root, "cols")[0];
	if (!cols) {
		cols = spreadsheetElement(root, "cols");
		const sheetData = children(root, "sheetData")[0] ??
			fail("A planilha não contém uma área de dados válida.");
		root.insertBefore(cols, sheetData);
	}

	// Split grouped definitions to preserve inherited styles without overlapping columns.
	for (const column of children(cols, "col")) {
		const min = Number(column.getAttribute("min"));
		const max = Number(column.getAttribute("max"));
		if (max < 6 || min > 9) continue;
		const ranges: Array<[number, number]> = [];
		if (min < 6) ranges.push([min, 5]);
		for (let number = Math.max(min, 6); number <= Math.min(max, 8); number++)
			ranges.push([number, number]);
		if (max > 9) ranges.push([10, max]);
		for (const [start, end] of ranges) {
			const copy = column.cloneNode(true) as Element;
			copy.setAttribute("min", String(start));
			copy.setAttribute("max", String(end));
			cols.insertBefore(copy, column);
		}
		cols.removeChild(column);
	}
	for (const [number, width] of OUTPUT_COLUMN_WIDTHS) {
		let column = children(cols, "col").find(
			(item) =>
				Number(item.getAttribute("min")) === number &&
				Number(item.getAttribute("max")) === number,
		);
		if (!column) {
			column = spreadsheetElement(cols, "col");
			column.setAttribute("min", String(number));
			column.setAttribute("max", String(number));
			const later = children(cols, "col").find(
				(item) => Number(item.getAttribute("min")) > number,
			);
			cols.insertBefore(column, later ?? null);
		}
		column.setAttribute("width", width);
		column.setAttribute("customWidth", "1");
	}

	const dimension = children(root, "dimension")[0];
	if (dimension && rowNodes.size) {
		const lastRow = Math.max(...rowNodes.keys());
		dimension.setAttribute("ref", `A1:H${lastRow}`);
	}
}

export async function writeFeriasWorkbook(
	buffer: Buffer,
	results: OutputRow[],
): Promise<Buffer> {
	const input = load(buffer);
	const { rows } = parseRows(input);
	if (!Array.isArray(results) || results.length !== rows.length)
		fail("O resultado não corresponde a todos os colaboradores da planilha.");
	const byRow = new Map<number, OutputRow>();
	for (const result of results) {
		if (
			!result ||
			!Number.isInteger(result.row) ||
			byRow.has(result.row) ||
			typeof result.unimedText !== "string" ||
			typeof result.loanText !== "string" ||
			result.unimedText.length > 256 ||
			result.loanText.length > 128 ||
			hasControlCharacters(result.unimedText + result.loanText)
		)
			fail("O resultado contém linhas duplicadas ou valores inválidos.");
		byRow.set(result.row, result);
	}
	for (const row of rows) {
		const result = byRow.get(row.row);
		if (
			!result ||
			row.days !== result.days ||
			row.highlight !== result.highlight
		)
			fail(`Linha ${row.row}: os dados mudaram. Analise a planilha novamente.`);
	}
	const styleFor = createStyleWriter(input.styles);
	ensureOutputLayout(input.sheet, input.rowNodes);
	const columns = elements(input.sheet, "col");
	for (const [rowNumber, row] of input.rowNodes) {
		if (rowNumber < 4) continue;
		const result = byRow.get(rowNumber);
		const legacyLoan = input.cellNodes.get(`I${rowNumber}`);
		if (legacyLoan) row.removeChild(legacyLoan);
		if (result || row.getAttribute("spans") === "1:9")
			row.setAttribute("spans", "1:8");
		for (let col = 1; col <= 8; col += 1) {
			const ref = `${String.fromCharCode(col + 64)}${rowNumber}`;
			let cell = input.cellNodes.get(ref);
			if (!cell && (col < 6 || !result)) continue;
			if (!cell) {
				cell = spreadsheetElement(row, "c");
				cell.setAttribute("r", ref);
				const later = children(row, "c").find(
					(other) => (other.getAttribute("r") ?? "").charCodeAt(0) > col + 64,
				);
				row.insertBefore(cell, later ?? children(row, "extLst")[0] ?? null);
			}
			if (col >= 6) {
				const text = !result
					? ""
					: col === 6
						? result.highlight
							? `${result.days} dias`
							: ""
						: col === 7
							? result.unimedText
							: col === 8
								? result.loanText
								: "";
				setText(cell, text);
			}
			if (!result) continue;
			const column = columns.find(
				(item) =>
					Number(item.getAttribute("min")) <= col &&
					Number(item.getAttribute("max")) >= col,
			);
			const originalStyle =
				cell.getAttribute("s") ??
				row.getAttribute("s") ??
				column?.getAttribute("style") ??
				"0";
			cell.setAttribute(
				"s",
				styleFor(originalStyle, result.highlight, col >= 6),
			);
		}
	}
	input.entries[input.sheetPath] = serializeUtf8(input.sheet);
	input.entries[input.stylesPath] = serializeUtf8(input.styles);
	const output = Buffer.from(zipSync(input.entries, { level: 6 }));
	if (output.length > MAX_WORKBOOK_BYTES)
		fail("A planilha gerada excede o limite de 5 MB.");
	try {
		validateXlsxArchive(output, {
			maxTotalUncompressedBytes: 20 * 1024 * 1024,
			maxEntryUncompressedBytes: 8 * 1024 * 1024,
		});
	} catch {
		throw new FeriasWorkbookError(
			"A planilha gerada excede os limites de segurança.",
		);
	}
	return output;
}
