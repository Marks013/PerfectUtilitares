import { describe, expect, it, vi } from "vitest";
import { buildPublicMetadata, buildWebApplicationJsonLd } from "./seo";

describe("public SEO helpers", () => {
  it("builds canonical and social metadata for a public tool", () => {
    vi.stubEnv("APP_URL", "https://perfectutilitares.example/");
    const metadata = buildPublicMetadata({
      title: "Comprimir PDF Online | PerfectUtilitares",
      description: "Descrição da ferramenta.",
      path: "/pdf/comprimir",
    });

    expect(metadata.title).toEqual({ absolute: "Comprimir PDF Online | PerfectUtilitares" });
    expect(metadata.alternates).toEqual({
      canonical: "https://perfectutilitares.example/pdf/comprimir",
    });
    expect(metadata.openGraph).toMatchObject({
      title: "Comprimir PDF Online | PerfectUtilitares",
      url: "https://perfectutilitares.example/pdf/comprimir",
    });
    vi.unstubAllEnvs();
  });

  it("describes a free web application", () => {
    vi.stubEnv("APP_URL", "https://perfectutilitares.example/");
    const data = buildWebApplicationJsonLd({
      title: "Editor",
      description: "Descrição",
      path: "/fotos",
      features: ["Recorte"],
    });

    expect(data).toMatchObject({
      "@type": "WebApplication",
      applicationCategory: "UtilitiesApplication",
      isAccessibleForFree: true,
      url: "https://perfectutilitares.example/fotos",
      offers: { price: "0", priceCurrency: "BRL" },
    });
    vi.unstubAllEnvs();
  });
});
