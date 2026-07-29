import { PdfOrganizerWorkspace } from "@/components/pdf/pdf-organizer-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function ExtrairPaginasPdfPage() {
  await requirePageModuleAccess("pdf");

  return <PdfOrganizerWorkspace operation="EXTRACT_PAGES" />;
}
