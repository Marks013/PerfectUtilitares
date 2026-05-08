import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { ThemeToggle } from "@/components/theme-toggle";

export default function EsqueciSenhaPage() {
  return (
    <main className="auth-gateway relative grid min-h-dvh place-items-center px-4 py-8">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <ForgotPasswordForm />
    </main>
  );
}
