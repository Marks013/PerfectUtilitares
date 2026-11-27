import { redirect } from "next/navigation";
import { Camera, Clock3, Sparkles } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { auth } from "@/auth";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";
import { parseRetryAfterSeconds, retryAfterInstruction } from "@/lib/api/retry-after";
import { loginAction } from "./actions";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Entrar",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; code?: string }>;
}) {
  const session = await auth();
  if (session?.user.status === "ACTIVE") {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const callbackUrl =
    params.callbackUrl?.startsWith("/") && !params.callbackUrl.startsWith("//")
      ? params.callbackUrl
      : "/dashboard";
  const errorMessageByCode: Record<string, string> = {
    missing: "Informe o e-mail e a senha para acessar o sistema.",
    email: "Informe um e-mail válido, como nome@empresa.com.",
    password: "Informe sua senha.",
    rate:
      "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.",
    "rate-unavailable":
      "O controle de tentativas está temporariamente indisponível. Tente novamente em instantes.",
    credentials:
      "E-mail ou senha não conferem. Revise os dados ou use a recuperação de senha.",
  };
  const retrySeconds = params.error === "CredentialsSignin" && typeof params.code === "string" && params.code.startsWith("rate-")
    ? parseRetryAfterSeconds(params.code.slice(5))
    : undefined;
  const errorMessage = retrySeconds !== undefined
    ? `Muitas tentativas de acesso. ${retryAfterInstruction(retrySeconds)}`
    : params.error
    ? errorMessageByCode[params.error] ?? errorMessageByCode.credentials
    : null;

  return (
    <main className="login-gateway min-h-dvh px-4 py-8">
      <section className="login-gateway__intro">
        <div className="login-gateway__brand">PU</div>
        <p className="dashboard-kicker">PerfectUtilitares</p>
        <h1>Use as ferramentas livremente. Entre quando quiser guardar seu trabalho.</h1>
        <p>
          Jornada, Fotos 3x4 e PDF são públicos. A conta mantém seu histórico
          de validações e dá acesso aos recursos pessoais.
        </p>
        <div className="login-gateway__features">
          <span>
            <Clock3 className="size-4" aria-hidden="true" />
            Validador de jornada
          </span>
          <span>
            <Camera className="size-4" aria-hidden="true" />
            Editor de fotos
          </span>
          <span>
            <Sparkles className="size-4" aria-hidden="true" />
            Fluxo direto
          </span>
        </div>
      </section>
      <LoginForm
        action={loginAction}
        callbackUrl={callbackUrl}
        passwordMaxLength={BCRYPT_PASSWORD_MAX_LENGTH}
        errorMessage={errorMessage}
        errorCode={params.error}
      />
    </main>
  );
}
