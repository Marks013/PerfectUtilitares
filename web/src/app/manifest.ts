import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PerfectUtilitares",
    short_name: "PerfectUtilitares",
    description: "Utilitários operacionais com módulo Unimed offline.",
    start_url: "/unimed/calculo",
    display: "standalone",
    background_color: "#07111f",
    theme_color: "#0f766e",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
