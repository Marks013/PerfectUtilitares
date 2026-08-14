import { afterEach, describe, expect, it, vi } from "vitest";
import {
  localDateInput,
  presenceApi,
  slugifyPresence,
} from "./presence-admin-model";

describe("presence admin model helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("slugifies names predictably", () => {
    expect(slugifyPresence("  Chá de Bebê — João & Ana  ")).toBe(
      "cha-de-bebe-joao-ana",
    );
    expect(slugifyPresence("----")).toBe("");
    expect(slugifyPresence("A".repeat(100))).toHaveLength(80);
  });

  it("formats a Date for datetime-local using the local timezone offset", () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(180);
    expect(localDateInput(new Date("2026-08-14T15:30:00.000Z"))).toBe(
      "2026-08-14T12:30",
    );
  });

  it("performs JSON requests with no-store and content headers when needed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      presenceApi<{ ok: boolean }>("/api/presence", {
        method: "POST",
        body: JSON.stringify({ title: "Evento" }),
        headers: { "x-test": "1" },
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/presence",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "x-test": "1",
        }),
      }),
    );
  });

  it("surfaces string and structured API errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Sem acesso" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Evento não encontrado" } }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response("não-json", { status: 500 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(presenceApi("/a")).rejects.toThrow("Sem acesso");
    await expect(presenceApi("/b")).rejects.toThrow("Evento não encontrado");
    await expect(presenceApi("/c")).rejects.toThrow(
      "Não foi possível concluir a operação.",
    );
  });
});
