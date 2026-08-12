import type { Metadata } from "next";
import { PresenceInvitation } from "@/components/presence/presence-invitation";

export const metadata: Metadata = {
  title: "Convite",
  description: "Confirme sua presença e consulte a lista de presentes.",
  robots: { index: false, follow: false, noarchive: true },
};

type PageProps = {
  params: Promise<{ eventSlug: string; guestSlug: string }>;
};

export default async function PresencePage({ params }: PageProps) {
  const { eventSlug, guestSlug } = await params;
  return <PresenceInvitation eventSlug={eventSlug} guestSlug={guestSlug} />;
}
