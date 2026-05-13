import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { DEFAULT_JORNADA_RULES } from "./default-rules";
import {
  DEFAULT_JORNADA_BATCH_CONFIG,
  NON_SUBORDINATE_SCHEDULE_LABEL,
  normalizarHorarioLote,
  validarJornadaBatchXlsx,
} from "./batch-validation";

async function createWorkbook(sheetXml: string) {
  const zip = new JSZip();
  zip.file("xl\\sheet1.xml", sheetXml);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("normalizarHorarioLote", () => {
  it("corrige somente imprecisão de Excel próxima ao minuto cheio", () => {
    expect(normalizarHorarioLote(0.5659722)).toBe("13:35");
    expect(normalizarHorarioLote("13:34:59.9980800")).toBe("13:35");
    expect(normalizarHorarioLote("13:59")).toBe("13:59");
    expect(normalizarHorarioLote(".5657")).toBe("13:34");
  });
});

describe("validarJornadaBatchXlsx", () => {
  it("lê relatório 110 e valida 13:35 sem transformar em 13:34", async () => {
    const buffer = await createWorkbook(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="1"><c r="C1" t="inlineStr"><is><t>J MARTINS SUPERMERCADOS PLANALTO LTDA</t></is></c></row>
          <row r="3"><c r="A3" t="inlineStr"><is><t>Nome</t></is></c><c r="E3" t="inlineStr"><is><t>Cargo</t></is></c><c r="I3" t="inlineStr"><is><t>Horário</t></is></c></row>
          <row r="121">
            <c r="A121"><v>7376</v></c>
            <c r="C121" t="inlineStr"><is><t>KATRYN FERNANDA CHIQUITO SARTORI</t></is></c>
            <c r="E121" t="inlineStr"><is><t>CAIXA</t></is></c>
            <c r="I121"><v>.5659722</v></c>
            <c r="K121"><v>.7083333</v></c>
            <c r="L121"><v>.7604167</v></c>
            <c r="N121"><v>.9236111</v></c>
          </row>
        </sheetData>
      </worksheet>`);

    const report = await validarJornadaBatchXlsx({
      buffer,
      fileName: "FPRE110.xlsx",
      config: DEFAULT_JORNADA_BATCH_CONFIG,
      rules: DEFAULT_JORNADA_RULES,
    });

    expect(report.totalLinhas).toBe(1);
    expect(report.validos).toBe(1);
    expect(report.erros).toBe(0);
    expect(report.linhas[0]?.horariosOriginais).toBe("13:35 17:00 18:15 22:10");
    expect(report.linhas[0]?.resultado?.duracaoCalculada).toBe("07:20");
  });

  it("contabiliza jornada 00:00 como não subordinada a horário", async () => {
    const buffer = await createWorkbook(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="3">
            <c r="A3"><v>9001</v></c>
            <c r="C3" t="inlineStr"><is><t>COLABORADOR SEM ESCALA</t></is></c>
            <c r="E3" t="inlineStr"><is><t>OPERADOR</t></is></c>
            <c r="I3"><v>0</v></c>
            <c r="K3"><v>0</v></c>
            <c r="L3"><v>0</v></c>
            <c r="N3"><v>0</v></c>
          </row>
        </sheetData>
      </worksheet>`);

    const report = await validarJornadaBatchXlsx({
      buffer,
      fileName: "FPRE110.xlsx",
      config: DEFAULT_JORNADA_BATCH_CONFIG,
      rules: DEFAULT_JORNADA_RULES,
    });

    expect(report.totalLinhas).toBe(1);
    expect(report.validos).toBe(1);
    expect(report.erros).toBe(0);
    expect(report.linhas[0]?.jornadaCompleta).toBe(
      NON_SUBORDINATE_SCHEDULE_LABEL,
    );
    expect(report.linhas[0]?.resultado?.mensagem).toBe(
      NON_SUBORDINATE_SCHEDULE_LABEL,
    );
    expect(report.jornadasRepetidas[NON_SUBORDINATE_SCHEDULE_LABEL]).toBe(1);
  });

  it("lê formato agrupado com código na coluna A e jornada na coluna B", async () => {
    const buffer = await createWorkbook(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="3">
            <c r="A3" t="inlineStr"><is><t>J001</t></is></c>
            <c r="B3" t="inlineStr"><is><t>08:00 às 12:00 e 13:00 às 17:00</t></is></c>
          </row>
        </sheetData>
      </worksheet>`);

    const report = await validarJornadaBatchXlsx({
      buffer,
      fileName: "agrupado.xlsx",
      config: {
        ...DEFAULT_JORNADA_BATCH_CONFIG,
        usarHorariosAgrupados: true,
      },
      rules: DEFAULT_JORNADA_RULES,
    });

    expect(report.totalLinhas).toBe(1);
    expect(report.linhas[0]?.matricula).toBe("J001");
    expect(report.linhas[0]?.horarios).toEqual([
      "08:00",
      "12:00",
      "13:00",
      "17:00",
    ]);
    expect(report.linhas[0]?.resultado?.duracaoCalculada).toBe("08:00");
  });

  it("lê linha de sábado sem nome e não duplica erro igual da jornada principal", async () => {
    const buffer = await createWorkbook(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="3">
            <c r="A3"><v>7707</v></c>
            <c r="C3" t="inlineStr"><is><t>ROGERIO SANTOS DE MENESES</t></is></c>
            <c r="E3" t="inlineStr"><is><t>BALCONISTA</t></is></c>
            <c r="I3" t="inlineStr"><is><t>09:00</t></is></c>
            <c r="K3" t="inlineStr"><is><t>12:00</t></is></c>
            <c r="L3" t="inlineStr"><is><t>13:00</t></is></c>
            <c r="N3" t="inlineStr"><is><t>16:00</t></is></c>
          </row>
          <row r="4">
            <c r="H4" t="inlineStr"><is><t>Sábado:</t></is></c>
            <c r="I4" t="inlineStr"><is><t>09:00</t></is></c>
            <c r="K4" t="inlineStr"><is><t>12:00</t></is></c>
            <c r="L4" t="inlineStr"><is><t>13:00</t></is></c>
            <c r="N4" t="inlineStr"><is><t>16:00</t></is></c>
          </row>
        </sheetData>
      </worksheet>`);

    const report = await validarJornadaBatchXlsx({
      buffer,
      fileName: "FPRE110.xlsx",
      config: DEFAULT_JORNADA_BATCH_CONFIG,
      rules: DEFAULT_JORNADA_RULES,
    });

    expect(report.totalLinhas).toBe(2);
    expect(report.linhas[1]?.nome).toBe("ROGERIO SANTOS DE MENESES");
    expect(report.linhas[1]?.cargo).toBe("BALCONISTA - Sábado");
    expect(report.linhas[0]?.resultado?.valido).toBe(false);
    expect(report.linhas[1]?.resultado?.valido).toBe(false);
    expect(report.erros).toBe(1);
    expect(report.linhasComErro).toHaveLength(1);
  });

  it("rejeita sábado de 08:00 quando a jornada principal é 08:00", async () => {
    const buffer = await createWorkbook(`<?xml version="1.0" encoding="UTF-8"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="3">
            <c r="A3"><v>9002</v></c>
            <c r="C3" t="inlineStr"><is><t>COLABORADOR OITO HORAS</t></is></c>
            <c r="E3" t="inlineStr"><is><t>OPERADOR</t></is></c>
            <c r="I3" t="inlineStr"><is><t>08:00</t></is></c>
            <c r="K3" t="inlineStr"><is><t>12:00</t></is></c>
            <c r="L3" t="inlineStr"><is><t>14:00</t></is></c>
            <c r="N3" t="inlineStr"><is><t>18:00</t></is></c>
          </row>
          <row r="4">
            <c r="H4" t="inlineStr"><is><t>Sábado:</t></is></c>
            <c r="I4" t="inlineStr"><is><t>08:00</t></is></c>
            <c r="K4" t="inlineStr"><is><t>12:00</t></is></c>
            <c r="L4" t="inlineStr"><is><t>14:00</t></is></c>
            <c r="N4" t="inlineStr"><is><t>18:00</t></is></c>
          </row>
        </sheetData>
      </worksheet>`);

    const report = await validarJornadaBatchXlsx({
      buffer,
      fileName: "FPRE110.xlsx",
      config: DEFAULT_JORNADA_BATCH_CONFIG,
      rules: DEFAULT_JORNADA_RULES,
    });

    expect(report.totalLinhas).toBe(2);
    expect(report.validos).toBe(1);
    expect(report.erros).toBe(1);
    expect(report.linhas[1]?.resultado?.mensagem).toContain(
      "Sábado deve ter jornada de 04:00",
    );
  });
});
