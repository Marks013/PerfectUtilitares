import nodemailer from "@perfectutilitares/smtp";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

describe("real SMTP dependency without external delivery", () => {
  it("composes a message with an intact PDF and the exact recipient envelope", async () => {
    const document = await PDFDocument.create();
    document.addPage([595, 842]);
    const pdf = Buffer.from(await document.save());
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "windows",
    });
    const result = await transport.sendMail({
      from: { name: "Departamento Pessoal", address: "dp@example.test" },
      to: [
        { name: "Filial 02", address: "loja02@example.test" },
        { name: "Filial 06", address: "loja06@example.test" },
      ],
      subject: "Conferência da escala",
      html: "<p>Segue a proposta para conferência.</p>",
      attachments: [{ filename: "escala.pdf", content: pdf }],
    });

    expect(result.envelope.from).toBe("dp@example.test");
    expect(result.envelope.to).toEqual(["loja02@example.test", "loja06@example.test"]);
    expect(result.messageId).toBeTruthy();
    const message = result.message.toString("utf8");
    expect(message).toContain("multipart/mixed");
    const attachment = message.match(
      /Content-Type: application\/pdf;[\s\S]*?Content-Transfer-Encoding: base64[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/i,
    );
    expect(attachment).not.toBeNull();
    const received = Buffer.from(attachment?.[1] ?? "", "base64");
    expect(received.equals(pdf)).toBe(true);
    expect((await PDFDocument.load(received)).getPageCount()).toBe(1);
  });

  it.each(["Equipe, Filial 02", "Equipe; Filial 02", "Equipe > Filial 02"])(
    "does not turn punctuation in the display name %s into another recipient",
    async (displayName) => {
      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
      const result = await transport.sendMail({
        from: "dp@example.test",
        to: '"' + displayName + '" <loja02@example.test>',
        subject: "Conferência",
        text: "Mensagem de teste local, sem entrega externa.",
      });
      expect(result.envelope.to).toEqual(["loja02@example.test"]);
    },
  );
});
