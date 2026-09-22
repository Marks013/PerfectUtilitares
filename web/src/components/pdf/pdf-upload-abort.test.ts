import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadPdf as uploadCompression } from "./pdf-compress-workspace-model";
import { uploadPdf as uploadEditor } from "./pdf-editor-workspace-model";
import { uploadPdf as uploadOrganizer } from "./pdf-organizer-workspace-model";

class UploadRequest extends EventTarget {
  static latest: UploadRequest;
  upload = new EventTarget();
  status = 200;
  responseText = '{"artifactId":"input-1"}';
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.dispatchEvent(new Event("loadend")));

  constructor() {
    super();
    UploadRequest.latest = this;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe.each([
  ["compressão", uploadCompression],
  ["editor", uploadEditor],
  ["organizador", uploadOrganizer],
] as const)("cancelamento do envio: %s", (_name, upload) => {
  it("interrompe o envio pendente quando o trabalho é limpo", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const controller = new AbortController();
    const file = new File(["%PDF"], "documento.pdf", { type: "application/pdf" });
    const pending = upload("job-1", file, vi.fn(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(UploadRequest.latest.abort).toHaveBeenCalledOnce();
  });

  it("não inicia outro envio após o cancelamento", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const controller = new AbortController();
    controller.abort();
    await expect(upload("job-1", new File(["%PDF"], "outro.pdf"), vi.fn(), controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(UploadRequest.latest.send).not.toHaveBeenCalled();
  });

  it("libera o listener após concluir o envio", async () => {
    vi.stubGlobal("XMLHttpRequest", UploadRequest);
    const controller = new AbortController();
    const pending = upload("job-1", new File(["%PDF"], "documento.pdf"), vi.fn(), controller.signal);
    const request = UploadRequest.latest;
    request.dispatchEvent(new Event("load"));
    request.dispatchEvent(new Event("loadend"));
    await pending;
    controller.abort();
    expect(request.abort).not.toHaveBeenCalled();
  });
});
