import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { getSiteUrl, SITE_NAME } from "@/lib/seo";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "PerfectUtilitares",
    template: "%s | PerfectUtilitares",
  },
  description:
    "Ferramentas públicas para validar jornadas, preparar fotos 3x4 e trabalhar com PDFs.",
  applicationName: SITE_NAME,
  category: "utilities",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description:
      "Ferramentas públicas para validar jornadas, preparar fotos 3x4 e trabalhar com PDFs.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description:
      "Ferramentas públicas para validar jornadas, preparar fotos 3x4 e trabalhar com PDFs.",
    images: ["/opengraph-image"],
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
  },
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark" data-theme="dark" suppressHydrationWarning>
      <body>
        <Script src="/global.js" strategy="beforeInteractive" />
        <WebVitalsReporter />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
