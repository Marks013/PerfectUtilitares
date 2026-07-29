import { PdfCompressWorkspace } from "@/components/pdf/pdf-compress-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function ComprimirPdfPage() {
  await requirePageModuleAccess("pdf");

  return <PdfCompressWorkspace />;
}
