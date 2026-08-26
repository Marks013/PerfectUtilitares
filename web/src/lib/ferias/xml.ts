import { posix } from "node:path";
import { crc32 } from "node:zlib";
import {
	type Document,
	DOMParser,
	type Element,
	XMLSerializer,
} from "@xmldom/xmldom";
import { unzipSync } from "fflate";
import {
	validateXlsxArchive,
	XlsxSecurityError,
} from "@/lib/spreadsheets/xlsx-security";
import { FeriasError } from "./errors";

export const SHEET_NS =
	"http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const REL_NS =
	"http://schemas.openxmlformats.org/package/2006/relationships";
export const OFFICE_REL_NS =
	"http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const PRINTER_TYPE =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings";
export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;

export class FeriasWorkbookError extends FeriasError {
	constructor(message: string) {
		super("FERIAS_WORKBOOK_INVALID", message);
		this.name = "FeriasWorkbookError";
	}
}

export function fail(message: string): never {
	throw new FeriasWorkbookError(message);
}

export function hasControlCharacters(value: string): boolean {
	return Array.from(value).some((char) => char.charCodeAt(0) < 32);
}

export function children(parent: Element, name: string): Element[] {
	return Array.from(parent.childNodes).filter(
		(node): node is Element =>
			node.nodeType === 1 &&
			(node as Element).localName === name &&
			(node as Element).namespaceURI === parent.namespaceURI,
	);
}

export function elements(
	doc: Document,
	name: string,
	namespace = SHEET_NS,
): Element[] {
	return Array.from(doc.getElementsByTagNameNS(namespace, name));
}

export function serialize(doc: Document | Element): string {
	return new XMLSerializer().serializeToString(doc);
}

export function serializeUtf8(doc: Document): Buffer {
	for (const node of Array.from(doc.childNodes)) {
		if (node.nodeType === 7 && node.nodeName === "xml") {
			doc.replaceChild(
				doc.createProcessingInstruction(
					"xml",
					'version="1.0" encoding="UTF-8" standalone="yes"',
				),
				node,
			);
		}
	}
	return Buffer.from(serialize(doc), "utf8");
}

export function spreadsheetElement(parent: Element, name: string): Element {
	const document = parent.ownerDocument;
	if (!document) fail("A estrutura XML da planilha está incompleta.");
	return document.createElementNS(
		SHEET_NS,
		parent.prefix ? `${parent.prefix}:${name}` : name,
	);
}

function parseXml(bytes: Uint8Array): Document {
	let text: string;
	try {
		const utf16le =
			(bytes[0] === 0xff && bytes[1] === 0xfe) ||
			(bytes[0] === 0x3c &&
				bytes[1] === 0 &&
				bytes[2] === 0x3f &&
				bytes[3] === 0);
		const utf16be =
			(bytes[0] === 0xfe && bytes[1] === 0xff) ||
			(bytes[0] === 0 &&
				bytes[1] === 0x3c &&
				bytes[2] === 0 &&
				bytes[3] === 0x3f);
		text = new TextDecoder(
			utf16le ? "utf-16le" : utf16be ? "utf-16be" : "utf-8",
			{ fatal: true },
		).decode(bytes);
	} catch {
		return fail("O arquivo contém texto inválido. Salve novamente como XLSX.");
	}
	if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text) || text.includes("\0")) {
		fail("O arquivo contém declarações XML não permitidas.");
	}
	try {
		return new DOMParser({
			onError: () => {
				fail("A estrutura XML da planilha está inválida.");
			},
		}).parseFromString(text, "application/xml");
	} catch {
		return fail("A estrutura XML da planilha está inválida.");
	}
}

export function relationshipTarget(relsPath: string, target: string): string {
	if (
		!target ||
		/[\\%?#]/.test(target) ||
		hasControlCharacters(target) ||
		target.startsWith("//") ||
		/^[a-z][a-z\d+.-]*:/i.test(target)
	) {
		return fail("A planilha contém um vínculo não permitido.");
	}
	const base = posix.dirname(posix.dirname(relsPath));
	const resolved = posix.normalize(
		target.startsWith("/") ? target.slice(1) : posix.join(base, target),
	);
	if (resolved.startsWith("../") || resolved === "..") {
		fail("A planilha contém um vínculo fora do arquivo.");
	}
	return resolved;
}

export type FeriasArchive = {
	entries: Record<string, Uint8Array>;
	documents: Map<string, Document>;
};

function validPrintReference(node: Element): boolean {
	const name = node.getAttribute("name");
	const value = node.textContent?.trim() ?? "";
	if (!value || value.length > 512) return false;
	const ranges = value.split(",");
	if (ranges.length > 8) return false;
	return ranges.every((range) => {
		const ref = /^(?:Plan1|'Plan1')!(.+)$/.exec(range.trim())?.[1];
		if (!ref) return false;
		if (name === "_xlnm.Print_Area") {
			const area =
				/^\$([A-H])\$([1-9]\d{0,3})(?::\$([A-H])\$([1-9]\d{0,3}))?$/.exec(ref);
			return Boolean(
				area &&
					Number(area[2]) <= 2_000 &&
					(!area[3] ||
						(area[1] <= area[3] &&
							Number(area[2]) <= Number(area[4]) &&
							Number(area[4]) <= 2_000)),
			);
		}
		if (name === "_xlnm.Print_Titles") {
			const rows = /^\$([1-9]\d{0,3}):\$([1-9]\d{0,3})$/.exec(ref);
			if (rows)
				return Number(rows[1]) <= Number(rows[2]) && Number(rows[2]) <= 2_000;
			const cols = /^\$([A-H]):\$([A-H])$/.exec(ref);
			return Boolean(cols && cols[1] <= cols[2]);
		}
		return false;
	});
}

function verifyEntryData(buffer: Buffer, entries: Record<string, Uint8Array>) {
	// Archive boundaries and metadata were checked before decompression.
	let footer = buffer.length - 22;
	while (footer >= Math.max(0, buffer.length - 65_557)) {
		if (
			buffer.readUInt32LE(footer) === 0x06054b50 &&
			footer + 22 + buffer.readUInt16LE(footer + 20) === buffer.length
		)
			break;
		footer -= 1;
	}
	if (footer < 0) fail("O arquivo XLSX está incompleto.");
	let cursor = buffer.readUInt32LE(footer + 16);
	const count = buffer.readUInt16LE(footer + 10);
	for (let index = 0; index < count; index += 1) {
		const nameLength = buffer.readUInt16LE(cursor + 28);
		const name = buffer
			.subarray(cursor + 46, cursor + 46 + nameLength)
			.toString("utf8");
		const content = entries[name];
		if (
			!content ||
			content.byteLength !== buffer.readUInt32LE(cursor + 24) ||
			crc32(content) !== buffer.readUInt32LE(cursor + 16)
		) {
			fail(
				"A integridade da planilha está comprometida. Salve e envie uma nova cópia.",
			);
		}
		cursor +=
			46 +
			nameLength +
			buffer.readUInt16LE(cursor + 30) +
			buffer.readUInt16LE(cursor + 32);
	}
}

export function openArchive(buffer: Buffer): FeriasArchive {
	if (!Buffer.isBuffer(buffer) || buffer.length > MAX_WORKBOOK_BYTES) {
		fail("Envie uma planilha XLSX de até 5 MB.");
	}
	try {
		// The original has a printerSettings .bin. Validate that narrow exception below.
		const security = validateXlsxArchive(buffer, {
			maxTotalUncompressedBytes: MAX_EXPANDED_BYTES,
			maxEntryUncompressedBytes: 8 * 1024 * 1024,
		});
		if (security.entryCount > 200 || security.usesLegacyPathSeparators) {
			fail(
				"A estrutura da planilha excede o formato aceito. Salve novamente como XLSX.",
			);
		}
		const entries = unzipSync(buffer);
		verifyEntryData(buffer, entries);
		const documents = new Map<string, Document>();
		let expanded = 0;
		let nodes = 0;
		for (const [name, data] of Object.entries(entries)) {
			expanded += data.byteLength;
			if (expanded > MAX_EXPANDED_BYTES)
				fail("A planilha descompactada excede 20 MB.");
			if (
				/(?:^|\/)(?:externalLinks|embeddings|oleObjects|activeX|macrosheets|dialogsheets|vbaProject|connections)(?:[/.]|$)/i.test(
					name,
				) ||
				(/\.bin$/i.test(name) &&
					!/^xl\/printerSettings\/printerSettings\d+\.bin$/.test(name))
			) {
				fail(
					"Macros, objetos incorporados e conexões externas não são aceitos.",
				);
			}
			if (name.endsWith("/") && data.byteLength === 0) continue;
			if (
				!/\.(?:xml|rels)$/i.test(name) &&
				!/^xl\/printerSettings\/printerSettings\d+\.bin$/.test(name)
			) {
				fail(
					"A planilha contém anexos não permitidos. Envie o modelo somente com dados e configurações de impressão.",
				);
			}
			if (!/\.(?:xml|rels)$/i.test(name)) continue;
			const doc = parseXml(data);
			for (const node of Array.from(doc.getElementsByTagName("*"))) {
				if (++nodes > 120_000)
					fail("A estrutura da planilha é excessivamente complexa.");
				if (
					["f", "formula", "formula1", "formula2"].includes(
						node.localName ?? "",
					)
				) {
					fail(
						"A planilha contém fórmulas. Envie uma cópia com valores fixos.",
					);
				}
				if (node.localName === "definedName" && !validPrintReference(node)) {
					fail("A planilha contém nomes calculados não permitidos.");
				}
			}
			documents.set(name, doc);
		}
		validatePackage(entries, documents);
		return { entries, documents };
	} catch (error) {
		if (error instanceof FeriasWorkbookError) throw error;
		if (error instanceof XlsxSecurityError) {
			throw new FeriasWorkbookError(error.message);
		}
		return fail(
			"Não foi possível ler a planilha. Verifique se é um XLSX válido.",
		);
	}
}

function validatePackage(
	entries: Record<string, Uint8Array>,
	documents: Map<string, Document>,
) {
	const types = documents.get("[Content_Types].xml");
	if (types?.documentElement?.namespaceURI !== TYPES_NS)
		fail("A planilha está incompleta.");
	const defaults = new Map<string, string>();
	const overrides = new Map<string, string>();
	for (const item of elements(types, "*", TYPES_NS)) {
		const type = item.getAttribute("ContentType") ?? "";
		if (
			/macroenabled|vba|activex|oleobject|macrosheet|dialogsheet/i.test(type)
		) {
			fail("Macros e objetos executáveis não são aceitos.");
		}
		if (item.localName === "Default")
			defaults.set(item.getAttribute("Extension") ?? "", type);
		if (item.localName === "Override")
			overrides.set(item.getAttribute("PartName") ?? "", type);
	}
	const printers = new Set<string>();
	for (const [name, doc] of documents) {
		if (!name.endsWith(".rels")) continue;
		if (doc.documentElement?.namespaceURI !== REL_NS)
			fail("Os vínculos internos são inválidos.");
		const ids = new Set<string>();
		for (const rel of elements(doc, "Relationship", REL_NS)) {
			const id = rel.getAttribute("Id");
			const type = rel.getAttribute("Type") ?? "";
			if (!id || ids.has(id))
				fail("A planilha contém vínculos duplicados ou inválidos.");
			ids.add(id);
			if ((rel.getAttribute("TargetMode") ?? "").toLowerCase() === "external") {
				fail("A planilha contém vínculos externos não permitidos.");
			}
			const target = relationshipTarget(name, rel.getAttribute("Target") ?? "");
			if (!entries[target])
				fail("A planilha contém um vínculo interno incompleto.");
			if (
				/vba|activex|oleobject|macrosheet|dialogsheet|externalLink/i.test(type)
			) {
				fail(
					"Macros, objetos incorporados e conexões externas não são aceitos.",
				);
			}
			if (
				type === `${OFFICE_REL_NS}/printerSettings` &&
				/^xl\/worksheets\/_rels\/[^/]+\.xml\.rels$/.test(name)
			)
				printers.add(target);
		}
	}
	for (const name of Object.keys(entries)) {
		if (!name.endsWith(".bin")) continue;
		if (
			!printers.has(name) ||
			(overrides.get(`/${name}`) ?? defaults.get("bin")) !== PRINTER_TYPE
		) {
			fail("A planilha contém um arquivo binário não permitido.");
		}
	}
}
