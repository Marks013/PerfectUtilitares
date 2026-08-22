const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const MAX_ZIP_ENTRIES = 10_000;
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_EXPANSION_RATIO = 250;
const MAX_ENTRY_EXPANSION_RATIO = 500;
const MAX_ENTRY_NAME_BYTES = 512;

export class XlsxSecurityError extends Error {
  readonly code = "XLSX_UNSAFE";

  constructor(public readonly reason: string) {
    super(`A planilha XLSX foi recusada por segurança: ${reason}.`);
    this.name = "XlsxSecurityError";
  }
}

function invalid(reason: string): never {
  throw new XlsxSecurityError(reason);
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const minimumOffset = Math.max(0, bytes.length - 22 - 65_535);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== EOCD_SIGNATURE) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) return offset;
  }
  return -1;
}

function safeEntryName(nameBytes: Buffer, utf8: boolean) {
  if (!utf8 && nameBytes.some((byte) => byte > 0x7f)) {
    invalid("há nomes internos com codificação não suportada");
  }
  const name = nameBytes.toString("utf8").replaceAll("\\", "/");
  const segments = name.split("/");
  if (
    !name ||
    name.includes("\0") ||
    name.includes("�") ||
    name.startsWith("/") ||
    /^[a-z]:/i.test(name) ||
    segments.some(
      (segment, index) =>
        segment === "." ||
        segment === ".." ||
        (segment === "" && index !== segments.length - 1),
    )
  ) {
    invalid("há um caminho interno inválido ou suspeito");
  }
  return name;
}

function validateStrictProfile(name: string) {
  const normalized = name.toLowerCase();
  if (
    normalized.endsWith(".bin") ||
    normalized === "xl/connections.xml" ||
    normalized.startsWith("xl/externallinks/") ||
    normalized.startsWith("xl/embeddings/") ||
    normalized.startsWith("xl/oleobjects/") ||
    normalized.startsWith("xl/activex/")
  ) {
    invalid(
      "macros, objetos incorporados, conexões e links externos não são aceitos",
    );
  }
}

export function validateXlsxArchive(
  bytes: Buffer,
  options: { strict?: boolean } = {},
) {
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== LOCAL_FILE_SIGNATURE) {
    invalid("o arquivo não possui uma assinatura ZIP/XLSX válida");
  }

  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) invalid("o diretório central está ausente ou truncado");

  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocdOffset + 8);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    invalid("arquivos ZIP divididos em volumes não são aceitos");
  }
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    invalid("a estrutura ZIP64 não é necessária nem aceita nesta importação");
  }
  if (entryCount === 0 || entryCount > MAX_ZIP_ENTRIES) {
    invalid(`a quantidade de itens internos excede ${MAX_ZIP_ENTRIES}`);
  }
  if (centralSize > MAX_CENTRAL_DIRECTORY_BYTES) {
    invalid("o diretório interno é excessivamente grande");
  }
  const centralEnd = centralOffset + centralSize;
  if (
    centralOffset < 4 ||
    centralEnd > eocdOffset ||
    centralEnd > bytes.length
  ) {
    invalid("o diretório central aponta para uma região inválida");
  }

  let cursor = centralOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  const names = new Set<string>();
  const requiredNames = new Set([
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
  ]);
  const spans: Array<{ start: number; end: number }> = [];
  let usesLegacyPathSeparators = false;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > centralEnd ||
      bytes.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE
    ) {
      invalid("uma entrada do diretório central está truncada");
    }

    const versionMadeBy = bytes.readUInt16LE(cursor + 4);
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const diskStart = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;

    if (
      entryEnd > centralEnd ||
      nameLength === 0 ||
      nameLength > MAX_ENTRY_NAME_BYTES
    ) {
      invalid("uma entrada interna possui tamanho ou nome inválido");
    }
    if (diskStart !== 0) invalid("uma entrada referencia outro volume ZIP");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      invalid("uma entrada usa metadados ZIP64 não permitidos");
    }
    if (
      (flags & 0x0001) !== 0 ||
      (flags & 0x0040) !== 0 ||
      (flags & 0x2000) !== 0
    ) {
      invalid("conteúdo ZIP criptografado ou mascarado não é aceito");
    }
    if (method !== 0 && method !== 8) {
      invalid("há um método de compactação não suportado");
    }
    const unixMode = (externalAttributes >>> 16) & 0xf000;
    if (versionMadeBy >>> 8 === 3 && unixMode === 0xa000) {
      invalid("links simbólicos internos não são aceitos");
    }

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    usesLegacyPathSeparators ||= nameBytes.includes(0x5c);
    const name = safeEntryName(nameBytes, (flags & 0x0800) !== 0);
    if (names.has(name)) invalid("há nomes internos duplicados");
    names.add(name);
    requiredNames.delete(name);
    if (options.strict) validateStrictProfile(name);

    if (uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      invalid("um item interno ultrapassa 128 MB descompactado");
    }
    if (compressedSize === 0 && uncompressedSize > 0) {
      invalid("um item declara conteúdo sem tamanho compactado");
    }
    if (
      compressedSize > 0 &&
      uncompressedSize / compressedSize > MAX_ENTRY_EXPANSION_RATIO
    ) {
      invalid("um item possui razão de expansão excessiva");
    }
    if (method === 0 && compressedSize !== uncompressedSize) {
      invalid("um item armazenado possui tamanhos inconsistentes");
    }

    if (
      localOffset + 30 > centralOffset ||
      bytes.readUInt32LE(localOffset) !== LOCAL_FILE_SIGNATURE
    ) {
      invalid("uma entrada local está ausente ou fora da região de dados");
    }
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localNameLength !== nameLength ||
      dataEnd > centralOffset ||
      !bytes
        .subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .equals(nameBytes)
    ) {
      invalid("os metadados locais e centrais são inconsistentes");
    }

    spans.push({ start: localOffset, end: dataEnd });
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      invalid("o conteúdo descompactado ultrapassa 256 MB");
    }
    cursor = entryEnd;
  }

  if (cursor !== centralEnd)
    invalid("o diretório central contém dados inesperados");
  if (requiredNames.size > 0)
    invalid("faltam estruturas obrigatórias de uma planilha XLSX");
  if (
    totalCompressed === 0 ||
    totalUncompressed / totalCompressed > MAX_TOTAL_EXPANSION_RATIO
  ) {
    invalid("a razão total de expansão é excessiva");
  }

  spans.sort((left, right) => left.start - right.start);

  let previousSpan: (typeof spans)[number] | undefined;

  for (const currentSpan of spans) {
    if (previousSpan && currentSpan.start < previousSpan.end) {
      invalid("há regiões internas sobrepostas");
    }

    previousSpan = currentSpan;
  }

  return {
    entryCount,
    totalCompressedBytes: totalCompressed,
    totalUncompressedBytes: totalUncompressed,
    usesLegacyPathSeparators,
  };
}

export function prepareXlsxArchive(
  bytes: Buffer,
  options: { strict?: boolean } = {},
) {
  const validation = validateXlsxArchive(bytes, options);
  if (!validation.usesLegacyPathSeparators) return bytes;

  const entries = unzipSync(bytes);
  const normalized: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(entries)) {
    const normalizedName = name.replaceAll("\\", "/");
    if (normalized[normalizedName]) {
      invalid("há nomes internos duplicados após normalização");
    }
    normalized[normalizedName] = content;
  }
  const prepared = Buffer.from(zipSync(normalized, { level: 6 }));
  validateXlsxArchive(prepared, options);
  return prepared;
}
import { unzipSync, zipSync } from "fflate";
