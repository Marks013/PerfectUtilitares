import { readFile } from "node:fs/promises";

const [namesPath, textPath] = process.argv.slice(2);

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

try {
  if (!namesPath || !textPath)
    throw new Error("Informe nomes e texto renderizado.");
  const names = JSON.parse(await readFile(namesPath, "utf8"));
  const documentText = normalize(await readFile(textPath, "utf8"));
  if (!Array.isArray(names) || names.length < 5 || names.length > 6) {
    throw new Error("Lista de dependentes inválida.");
  }
  for (const name of names) {
    if (!documentText.includes(normalize(String(name)))) {
      throw new Error("Documento renderizado omitiu dependente.");
    }
  }
  if (!documentText.includes("______/______/________")) {
    throw new Error("Documento renderizado omitiu ou cortou o campo DATA.");
  }
  console.log(
    `RN561 renderizado contém ${names.length} dependentes e o campo DATA completo.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
