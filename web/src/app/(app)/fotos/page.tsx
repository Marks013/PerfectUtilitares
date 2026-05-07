import { Photo3x4Workspace } from "@/components/photo-3x4-workspace";
import { requirePageModuleAccess } from "@/lib/modules/access";

export default async function FotosPage() {
  await requirePageModuleAccess("fotos");

  return <Photo3x4Workspace />;
}
