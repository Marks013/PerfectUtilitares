import { PdfOrganizerWorkspace } from "@/components/pdf/pdf-organizer-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function PdfParaJpgPage() {
  await requirePageModuleAccess("pdf");

  return <PdfOrganizerWorkspace operation="PDF_TO_JPG" />;
}
