import { PdfEditorWorkspace } from "@/components/pdf/pdf-editor-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function AnotarPdfPage() {
  await requirePageModuleAccess("pdf");
  return <PdfEditorWorkspace operation="ANNOTATE" />;
}
