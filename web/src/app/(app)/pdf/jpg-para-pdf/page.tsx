import { ImagesToPdfWorkspace } from "@/components/pdf/images-to-pdf-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function JpgParaPdfPage() {
  await requirePageModuleAccess("pdf");

  return <ImagesToPdfWorkspace />;
}
