import { PdfEditorWorkspace } from "@/components/pdf/pdf-editor-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function EditarPdfPage() {
  await requirePageModuleAccess("pdf");
  return <PdfEditorWorkspace operation="EDIT" />;
}
