import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { Photo3x4Workspace } from "@/components/photo-3x4-workspace";
import { PublicToolGuide } from "@/components/public-tool-guide";
import { getOptionalPageSession } from "@/lib/modules/access";
import { buildPublicMetadata, buildWebApplicationJsonLd } from "@/lib/seo";

const title = "Editor de Foto 3x4 Online | PerfectUtilitares";
const description =
  "Prepare fotos 3x4 individualmente ou em lote com corte, enquadramento, ajustes, conversão de formato e download em imagem ou ZIP.";
const path = "/fotos";

export const metadata: Metadata = buildPublicMetadata({
  title,
  description,
  path,
  keywords: [
    "editor de foto 3x4 online",
    "cortar foto 3x4",
    "foto 3x4 em lote",
    "converter foto para JPG",
  ],
});

export default async function FotosPage() {
  const session = await getOptionalPageSession();

  return (
    <>
      <JsonLd
        data={buildWebApplicationJsonLd({
          title,
          description,
          path,
          features: [
            "Corte e enquadramento 3x4",
            "Detecção facial para auxiliar o recorte",
            "Ajuste de brilho, contraste e qualidade",
            "Processamento em lote com download ZIP",
          ],
        })}
      />
      <Photo3x4Workspace userId={session?.user.id ?? "public"} />
      <PublicToolGuide
        title="Prepare fotos 3x4 com enquadramento consistente"
        introduction="Carregue uma ou várias imagens, confira o recorte e ajuste a saída antes de processar. O editor mantém cada foto independente para facilitar trabalhos em lote."
        sections={[
          {
            title: "Recorte assistido",
            text: "A detecção facial sugere um enquadramento inicial. Você ainda pode mover e ampliar a imagem para acertar a composição individualmente.",
          },
          {
            title: "Ajustes de saída",
            text: "Brilho, contraste, qualidade, borda e formato podem ser alterados antes de gerar o arquivo final, sem modificar a imagem original.",
          },
          {
            title: "Individual ou em lote",
            text: "Baixe a foto atual separadamente ou reúna todas as imagens processadas em um único arquivo ZIP organizado.",
          },
        ]}
        tips={[
          "Prefira imagens nítidas, com o rosto visível e iluminação uniforme.",
          "Revise o enquadramento de cada pessoa antes de processar o lote.",
        ]}
      />
    </>
  );
}
