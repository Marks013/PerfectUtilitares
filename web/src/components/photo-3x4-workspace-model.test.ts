import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhotoSettings } from "@/lib/photos/schema";
import {
  appendBatchCrops,
  appendSettings,
  detectFaceInFrame,
  downloadResult,
  getDownloadFileName,
  getEditorState,
  getErrorMessage,
  getFileKey,
  getPhotoFormErrorMessages,
  getPhotoSettingsStorageKey,
  isSameFileName,
  loadImage,
  type EditorState,
  type ResultFile,
} from "./photo-3x4-workspace-model";

describe("photo 3x4 workspace model helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("builds stable storage/file keys and compares names case-insensitively", () => {
    expect(getPhotoSettingsStorageKey("user-1")).toBe(
      "photo-3x4:settings:v3:user-1",
    );
    expect(getFileKey({ name: "Minha Foto.JPG" } as File)).toBe(
      "Minha Foto.JPG",
    );
    expect(isSameFileName(" Foto.JPG ", "foto.jpg")).toBe(true);
    expect(isSameFileName("a.jpg", "b.jpg")).toBe(false);
  });

  it("extracts API error messages from string, object and invalid JSON responses", async () => {
    await expect(
      getErrorMessage(
        new Response(JSON.stringify({ error: "Arquivo inválido" }), {
          headers: { "content-type": "application/json" },
        }),
      ),
    ).resolves.toBe("Arquivo inválido");

    await expect(
      getErrorMessage(
        new Response(
          JSON.stringify({ error: { message: "Imagem muito pequena" } }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    ).resolves.toBe("Imagem muito pequena");

    await expect(getErrorMessage(new Response("não-json"))).resolves.toBe(
      "Não foi possível processar a imagem. Revise a foto e tente novamente.",
    );
  });

  it("reads a download filename or uses the fallback", () => {
    expect(
      getDownloadFileName(
        new Response("", {
          headers: {
            "content-disposition": 'attachment; filename="foto-pronta.jpg"',
          },
        }),
        "fallback.jpg",
      ),
    ).toBe("foto-pronta.jpg");

    expect(getDownloadFileName(new Response(""), "fallback.jpg")).toBe(
      "fallback.jpg",
    );
  });

  it("serializes photo settings into FormData", () => {
    const formData = new FormData();
    const values: PhotoSettings = {
      width: 354,
      height: 472,
      quality: 88,
      format: "original",
      contrast: 1.2,
      brightness: 0.9,
      addBorder: true,
      borderWidth: 7,
      borderColor: "white",
      replaceOriginal: false,
      convertToJpg: true,
    };

    appendSettings(formData, values);

    expect(Object.fromEntries(formData.entries())).toEqual({
      quality: "88",
      format: "jpeg",
      contrast: "1.2",
      brightness: "0.9",
      addBorder: "true",
      borderWidth: "7",
      borderColor: "white",
      replaceOriginal: "true",
      convertToJpg: "false",
    });
  });

  it("serializes only available manual crops", () => {
    const formData = new FormData();
    const files = [
      { name: "a.jpg" } as File,
      { name: "b.jpg" } as File,
    ];
    const base: EditorState = {
      crop: { x: 0, y: 0 },
      zoom: 1,
      croppedArea: null,
      pendingFaceArea: null,
      cropMode: "manual",
      contrast: 1,
      brightness: 1,
    };
    const editorStates: Record<string, EditorState> = {
      "a.jpg": {
        ...base,
        croppedArea: { x: 1, y: 2, width: 100, height: 120 },
      },
      "b.jpg": base,
    };

    appendBatchCrops(formData, files, editorStates);

    expect(JSON.parse(String(formData.get("crops")))).toEqual({
      "a.jpg": { x: 1, y: 2, width: 100, height: 120 },
    });

    const empty = new FormData();
    appendBatchCrops(empty, [{ name: "b.jpg" } as File], editorStates);
    expect(empty.has("crops")).toBe(false);
  });

  it("returns stored editor state or the default state", () => {
    const custom: EditorState = {
      crop: { x: 4, y: 8 },
      zoom: 2,
      croppedArea: { x: 1, y: 2, width: 3, height: 4 },
      pendingFaceArea: null,
      cropMode: "manual",
      contrast: 1.3,
      brightness: 0.8,
    };
    const states = { "foto.jpg": custom };

    expect(getEditorState(states, "foto.jpg")).toBe(custom);
    expect(getEditorState(states, "ausente.jpg")).toMatchObject({
      crop: { x: 0, y: 0 },
      zoom: 1,
      cropMode: "auto",
    });
    expect(getEditorState(states, null)).toMatchObject({
      crop: { x: 0, y: 0 },
      zoom: 1,
    });
  });

  it("collects form messages and provides a fallback", () => {
    expect(
      getPhotoFormErrorMessages({
        quality: { message: "Qualidade inválida" },
        border: { message: 42 },
        empty: null,
      }),
    ).toEqual(["Qualidade inválida"]);

    expect(getPhotoFormErrorMessages({})).toEqual([
      "Revise formato, qualidade e borda antes de processar.",
    ]);
  });

  it("loads an image and propagates preview errors", async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private value = "";

      set src(next: string) {
        this.value = next;
        queueMicrotask(() => {
          if (next === "ok") this.onload?.();
          else this.onerror?.();
        });
      }

      get src() {
        return this.value;
      }
    }

    vi.stubGlobal("Image", FakeImage);

    await expect(loadImage("ok")).resolves.toBeInstanceOf(FakeImage);
    await expect(loadImage("erro")).rejects.toThrow(
      "Não foi possível pré-visualizar a foto",
    );
  });

  it("completes frame-based face detection and cleans up the iframe", async () => {
    const messageHandlers: Array<
      (event: MessageEvent<Record<string, unknown>>) => void
    > = [];
    const remove = vi.fn();
    const postMessage = vi.fn();
    const clearTimeout = vi.fn();
    const iframe = {
      contentWindow: { postMessage },
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      remove,
      setAttribute: vi.fn(),
      src: "",
      title: "",
      tabIndex: 0,
      style: { display: "" },
    };
    const addEventListener = vi.fn(
      (
        type: string,
        handler: (event: MessageEvent<Record<string, unknown>>) => void,
      ) => {
        if (type === "message") messageHandlers.push(handler);
      },
    );
    const removeEventListener = vi.fn();
    const appendChild = vi.fn();

    vi.stubGlobal("window", {
      location: { origin: "http://localhost" },
      setTimeout: vi.fn(() => 41),
      clearTimeout,
      addEventListener,
      removeEventListener,
    });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => iframe),
      body: { appendChild },
    });

    const result = {
      detections: [
        {
          boundingBox: {
            xCenter: 0.5,
            yCenter: 0.5,
            width: 0.25,
            height: 0.3,
          },
        },
      ],
      imageWidth: 1200,
      imageHeight: 1600,
    };

    const promise = detectFaceInFrame({ name: "foto.jpg" } as File, 5_000);

    expect(appendChild).toHaveBeenCalledWith(iframe);
    expect(addEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );

    iframe.onload?.();
    expect(postMessage).toHaveBeenCalledOnce();
    const request = postMessage.mock.calls[0]?.[0] as
      | { requestId?: string }
      | undefined;
    expect(request?.requestId).toBeTruthy();

    const messageHandler = messageHandlers[0];
    if (!messageHandler) {
      throw new Error("O listener de detecção de rosto não foi registrado.");
    }
    messageHandler({
      origin: "http://localhost",
      source: iframe.contentWindow,
      data: {
        type: "photo-3x4:face-detection-result",
        requestId: request?.requestId,
        ok: true,
        result,
      },
    } as unknown as MessageEvent<Record<string, unknown>>);

    await expect(promise).resolves.toEqual(result);
    expect(clearTimeout).toHaveBeenCalledWith(41);
    expect(removeEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
    expect(remove).toHaveBeenCalledOnce();
  });

  it("creates a new object URL for every download and revokes it later", () => {
    vi.useFakeTimers();
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:primeiro")
      .mockReturnValueOnce("blob:segundo");
    const revokeObjectURL = vi.fn();
    const links: Array<{ href: string; download: string }> = [];
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => {
        const link = {
          href: "",
          download: "",
          click: vi.fn(),
          remove: vi.fn(),
        };
        links.push(link);
        return link;
      }),
    });

    const result: ResultFile = {
      blob: new Blob(["foto"]),
      fileName: "foto.jpg",
      label: "Foto",
    };
    downloadResult(result);
    downloadResult(result);

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(links.map((link) => link.href)).toEqual([
      "blob:primeiro",
      "blob:segundo",
    ]);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, "blob:primeiro");
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, "blob:segundo");
  });
});
