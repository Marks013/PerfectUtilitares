import { JornadaValidationForm } from "@/components/jornada-validation-form";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function ValidarJornadaPage() {
  await requirePageModuleAccess("jornada");

  return <JornadaValidationForm />;
}
