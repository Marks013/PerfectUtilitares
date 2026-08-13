import Script from "next/script";

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return (
    <Script id="perfectutilitares-web-application" type="application/ld+json">
      {json}
    </Script>
  );
}
