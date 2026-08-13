import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { JornadaValidationForm } from "@/components/jornada-validation-form";
import { PublicToolGuide } from "@/components/public-tool-guide";
import { getOptionalPageSession } from "@/lib/modules/access";
import { buildPublicMetadata, buildWebApplicationJsonLd } from "@/lib/seo";

const title = "Validador de Jornada Online | PerfectUtilitares";
const description =
  "Valide horários de jornada, intervalos, períodos e descanso entre dias com identificação do código de horário correspondente.";
const path = "/jornada/validar";

export const metadata: Metadata = buildPublicMetadata({
  title,
  description,
  path,
  keywords: [
    "validador de jornada online",
    "cálculo de jornada de trabalho",
    "intervalo intrajornada",
    "interjornada",
  ],
});

export default async function ValidarJornadaPage() {
  const session = await getOptionalPageSession();

  return (
    <>
      <JsonLd
        data={buildWebApplicationJsonLd({
          title,
          description,
          path,
          features: [
            "Formatação automática de horários",
            "Validação de períodos e intervalos",
            "Identificação de código de jornada",
            "Planejamento opcional de interjornada",
          ],
        })}
      />
      <JornadaValidationForm userId={session?.user.id ?? "public"} />
      <PublicToolGuide
        title="Como conferir uma jornada de trabalho"
        introduction="Informe dois horários para uma jornada contínua ou quatro horários quando houver intervalo. O resultado detalha duração, períodos, intervalo e o código encontrado na base de horários."
        sections={[
          {
            title: "Entrada dos horários",
            text: "Use a ordem de entrada e saída. Com a formatação automática ativa, valores como 0800 1200 1400 1800 são convertidos para o padrão HH:MM.",
          },
          {
            title: "Intervalos e períodos",
            text: "A validação confere separadamente o período anterior e posterior ao intervalo, além da duração total e do descanso informado.",
          },
          {
            title: "Código correspondente",
            text: "Quando os horários coincidem com a base compartilhada, o código da jornada é apresentado junto ao resultado para facilitar a conferência.",
          },
        ]}
        tips={[
          "A interjornada é opcional e auxilia no planejamento do descanso entre dias.",
          "Usuários autenticados podem consultar o histórico das próprias validações.",
        ]}
      />
    </>
  );
}
