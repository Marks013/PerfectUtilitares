import { Photo3x4Workspace } from "@/components/photo-3x4-workspace";
import { getOptionalPageSession } from "@/lib/modules/access";

export default async function FotosPage() {
  const session = await getOptionalPageSession();

  return <Photo3x4Workspace userId={session?.user.id ?? "public"} />;
}
