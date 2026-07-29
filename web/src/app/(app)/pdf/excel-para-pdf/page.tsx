import { PdfOfficeConvertWorkspace } from "@/components/pdf/pdf-office-convert-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function ExcelToPdfPage() {
  await requirePageModuleAccess("pdf");
  return <PdfOfficeConvertWorkspace operation="EXCEL_TO_PDF" />;
}
