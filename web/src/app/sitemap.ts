import type { MetadataRoute } from "next";

const routes = [
  "/dashboard",
  "/jornada/validar",
  "/fotos",
  "/pdf",
  "/pdf/comprimir",
  "/pdf/juntar",
  "/pdf/dividir",
  "/pdf/girar",
  "/pdf/excluir-paginas",
  "/pdf/extrair-paginas",
  "/pdf/organizar",
  "/pdf/editar",
  "/pdf/anotar",
  "/pdf/recortar",
  "/pdf/para-word",
  "/pdf/para-excel",
  "/pdf/para-jpg",
  "/pdf/word-para-pdf",
  "/pdf/excel-para-pdf",
  "/pdf/jpg-para-pdf",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.APP_URL ?? "http://localhost:3002";
  const lastModified = new Date();

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified,
    changeFrequency: "monthly",
    priority: route === "/dashboard" ? 1 : 0.8,
  }));
}
