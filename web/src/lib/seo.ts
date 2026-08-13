import type { Metadata } from "next";

export const SITE_NAME = "PerfectUtilitares";

export function getSiteUrl() {
  return new URL(process.env.APP_URL ?? "http://localhost:3002");
}

type PublicMetadataInput = {
  title: string;
  description: string;
  path: string;
  keywords?: string[];
};

export function buildPublicMetadata({
  title,
  description,
  path,
  keywords,
}: PublicMetadataInput): Metadata {
  const canonical = new URL(path, getSiteUrl()).toString();

  return {
    title: { absolute: title },
    description,
    keywords,
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: SITE_NAME,
      title,
      description,
      url: canonical,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} - utilitários online`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/opengraph-image"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
  };
}

type WebApplicationInput = PublicMetadataInput & {
  features: string[];
};

export function buildWebApplicationJsonLd({
  title,
  description,
  path,
  features,
}: WebApplicationInput) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: title,
    description,
    url: new URL(path, getSiteUrl()).toString(),
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Qualquer sistema com navegador moderno",
    browserRequirements: "JavaScript habilitado",
    inLanguage: "pt-BR",
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "BRL",
    },
    featureList: features,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: getSiteUrl().toString(),
    },
  };
}
