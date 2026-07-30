import { JornadaValidationForm } from "@/components/jornada-validation-form";
import { getOptionalPageSession } from "@/lib/modules/access";

export default async function ValidarJornadaPage() {
  const session = await getOptionalPageSession();

  return <JornadaValidationForm userId={session?.user.id ?? "public"} />;
}
