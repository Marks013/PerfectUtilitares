import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { ThemeToggle } from "@/components/theme-toggle";

type ConvitePageProps = {
  params: Promise<{ token: string }>;
};

export default async function ConvitePage({ params }: ConvitePageProps) {
  const { token } = await params;

  return (
    <main className="auth-gateway relative grid min-h-dvh place-items-center px-4 py-8">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <AcceptInvitationForm token={token} />
    </main>
  );
}
