import { PdfOfficeConvertWorkspace } from "@/components/pdf/pdf-office-convert-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function WordToPdfPage() {
  await requirePageModuleAccess("pdf");
  return <PdfOfficeConvertWorkspace operation="WORD_TO_PDF" />;
}
