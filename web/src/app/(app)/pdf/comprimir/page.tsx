import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { PdfCompressWorkspace } from "@/components/pdf/pdf-compress-workspace";
import { PublicToolGuide } from "@/components/public-tool-guide";
import { buildPublicMetadata, buildWebApplicationJsonLd } from "@/lib/seo";

const title = "Comprimir PDF Online | PerfectUtilitares";
const description =
  "Comprima arquivos PDF online com análise do documento e controle de DPI, tonalidade e intensidade para equilibrar tamanho e legibilidade.";
const path = "/pdf/comprimir";

export const metadata: Metadata = buildPublicMetadata({
  title,
  description,
  path,
  keywords: [
    "comprimir PDF online",
    "reduzir tamanho de PDF",
    "alterar DPI de PDF",
    "PDF em tons de cinza",
  ],
});

export default function ComprimirPdfPage() {

  return (
    <>
      <JsonLd
        data={buildWebApplicationJsonLd({
          title,
          description,
          path,
          features: [
            "Análise automática do documento",
            "Controle de DPI e tonalidade",
            "Perfis de compactação",
            "Download individual ou em lote por ZIP",
          ],
        })}
      />
      <PdfCompressWorkspace />
      <PublicToolGuide
        title="Reduza o PDF sem perder o que importa"
        introduction="A compactação analisa o arquivo enviado e apresenta as características detectadas antes do processamento. Você pode manter a sugestão ou ajustar cada opção conforme o uso final."
        sections={[
          {
            title: "DPI e resolução",
            text: "Valores menores reduzem mais o arquivo, mas podem afetar textos pequenos e imagens. Para leitura em tela, normalmente não é necessário preservar resolução de impressão.",
          },
          {
            title: "Tonalidade",
            text: "Mantenha os tons originais em PDFs que misturam texto preto, imagens em cinza e gráficos coloridos. Escolha cinza se a cor for dispensável; preto e branco pode apagar gradações que ajudam a ler gráficos e fotos.",
          },
          {
            title: "Resultado comparável",
            text: "Ao finalizar, confira o tamanho original e o tamanho obtido. Uma redução pequena pode indicar que o documento já estava bem compactado.",
          },
        ]}
        tips={[
          "Confira a legibilidade do resultado antes de descartar o arquivo original.",
          "Arquivos processados são temporários e não formam histórico no módulo de PDF.",
        ]}
      />
    </>
  );
}
