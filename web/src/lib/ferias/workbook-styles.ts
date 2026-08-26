import type { Document, Element } from "@xmldom/xmldom";
import { children, fail, serialize, spreadsheetElement } from "./xml";

function collection(doc: Document, name: string): Element {
	const root = doc.documentElement;
	const result = root && children(root, name)[0];
	if (!result) return fail("Os estilos da planilha estão incompletos.");
	return result;
}

function indexAttribute(node: Element, name: string, length: number): number {
	const text = node.getAttribute(name) ?? "0";
	const value = Number(text);
	if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value >= length) {
		fail("A planilha contém uma referência de estilo inválida.");
	}
	return value;
}

export function createStyleWriter(doc: Document) {
	const fonts = collection(doc, "fonts");
	const borders = collection(doc, "borders");
	const formats = collection(doc, "cellXfs");
	const fontItems = children(fonts, "font");
	const borderItems = children(borders, "border");
	const formatItems = children(formats, "xf");
	if (
		!fontItems.length ||
		!borderItems.length ||
		!formatItems.length ||
		formatItems.length > 4_000
	) {
		fail("A quantidade de estilos da planilha não é suportada.");
	}
	const cache = new Map<string, number>();
	const formatCache = new Map(
		formatItems.map((item, index) => [serialize(item), index]),
	);
	const fontCache = new Map(
		fontItems.map((item, index) => [serialize(item), index]),
	);
	const borderCache = new Map(
		borderItems.map((item, index) => [serialize(item), index]),
	);

	function append(
		parent: Element,
		items: Element[],
		item: Element,
		itemsCache: Map<string, number>,
	) {
		const key = serialize(item);
		const existing = itemsCache.get(key);
		if (existing !== undefined) return existing;
		if (items.length >= 8_000) fail("A planilha possui estilos em excesso.");
		const index = items.length;
		parent.appendChild(item);
		items.push(item);
		parent.setAttribute("count", String(items.length));
		itemsCache.set(key, index);
		return index;
	}

	function fontFor(index: number, bold: boolean) {
		const original = fontItems[index];
		const b = children(original, "b")[0];
		const oldBold = Boolean(
			b && !["0", "false"].includes(b.getAttribute("val") ?? "1"),
		);
		if (oldBold === bold) return index;
		const font = original.cloneNode(true) as Element;
		for (const existing of children(font, "b")) font.removeChild(existing);
		if (bold) font.appendChild(spreadsheetElement(font, "b"));
		return append(fonts, fontItems, font, fontCache);
	}

	function borderFor(index: number) {
		const border = borderItems[index].cloneNode(true) as Element;
		for (const side of ["left", "right", "top", "bottom"]) {
			let edge = children(border, side)[0];
			if (!edge) {
				edge = spreadsheetElement(border, side);
				const before =
					children(border, "diagonal")[0] ??
					children(border, "vertical")[0] ??
					children(border, "horizontal")[0] ??
					null;
				border.insertBefore(edge, before);
			}
			edge.setAttribute("style", "thin");
			for (const color of children(edge, "color")) edge.removeChild(color);
			const color = spreadsheetElement(edge, "color");
			color.setAttribute("rgb", "FF000000");
			edge.appendChild(color);
		}
		return append(borders, borderItems, border, borderCache);
	}

	return (sourceStyle: string, bold: boolean, output: boolean): string => {
		const key = `${sourceStyle}:${bold}:${output}`;
		const cached = cache.get(key);
		if (cached !== undefined) return String(cached);
		const index = Number(sourceStyle);
		if (
			!/^\d+$/.test(sourceStyle) ||
			!Number.isSafeInteger(index) ||
			!formatItems[index]
		) {
			return fail("A planilha contém uma referência de estilo inválida.");
		}
		const format = formatItems[index].cloneNode(true) as Element;
		format.setAttribute(
			"fontId",
			String(fontFor(indexAttribute(format, "fontId", fontItems.length), bold)),
		);
		format.setAttribute("applyFont", "1");
		if (output) {
			format.setAttribute(
				"borderId",
				String(
					borderFor(indexAttribute(format, "borderId", borderItems.length)),
				),
			);
			format.setAttribute("applyBorder", "1");
		}
		const result = append(formats, formatItems, format, formatCache);
		cache.set(key, result);
		return String(result);
	};
}
