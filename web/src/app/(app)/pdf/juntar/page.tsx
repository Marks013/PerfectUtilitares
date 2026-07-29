import { PdfOrganizerWorkspace } from "@/components/pdf/pdf-organizer-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function JuntarPdfPage() {
  await requirePageModuleAccess("pdf");

  return <PdfOrganizerWorkspace operation="MERGE" />;
}
