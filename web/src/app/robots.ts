import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.APP_URL ?? "http://localhost:3002";

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/dashboard", "/jornada/validar", "/fotos", "/pdf/"],
      disallow: [
        "/admin/",
        "/api/",
        "/conta",
        "/convite/",
        "/esqueci-senha",
        "/jornada/codigos",
        "/jornada/historico",
        "/jornada/regras",
        "/login",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
