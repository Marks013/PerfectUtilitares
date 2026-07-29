import { PdfOfficeConvertWorkspace } from "@/components/pdf/pdf-office-convert-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function PdfToWordPage() {
  await requirePageModuleAccess("pdf");
  return <PdfOfficeConvertWorkspace operation="PDF_TO_WORD" />;
}
