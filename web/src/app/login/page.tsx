import { redirect } from "next/navigation";
import { Camera, Clock3, KeyRound, Sparkles } from "lucide-react";
import Link from "next/link";
import { auth } from "@/auth";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";
import { loginAction } from "./actions";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Entrar",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
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
  const errorMessage = params.error
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
      <form
        action={loginAction}
        className="login-gateway__form w-full max-w-sm app-radius-lg border app-border app-bg-card p-6 app-shadow"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 app-text-muted" aria-hidden="true" />
          <h2 className="text-xl font-semibold app-text">Entrar</h2>
        </div>
        <p className="mt-1 text-sm app-text-muted">
          Use seu e-mail e senha para acessar seu histórico.
        </p>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        {errorMessage ? (
          <div className="mt-4 app-radius-md border app-border-danger app-bg-danger-soft px-3 py-2 text-sm app-text-danger">
            {errorMessage}
          </div>
        ) : null}

        <label className="mt-5 block text-sm font-medium app-text">
          E-mail
          <input
            name="email"
            type="email"
            autoComplete="username"
            maxLength={254}
            required
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none focus:border-neutral-900"
            placeholder="nome@empresa.com"
          />
        </label>

        <label className="mt-4 block text-sm font-medium app-text">
          Senha
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={BCRYPT_PASSWORD_MAX_LENGTH}
            required
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none focus:border-neutral-900"
            placeholder="Digite sua senha"
          />
        </label>

        <button
          type="submit"
          className="app-primary-button mt-5 w-full app-radius-md px-3 py-2 text-sm font-medium"
        >
          Entrar
        </button>
        <Link
          href="/esqueci-senha"
          className="mt-3 inline-flex w-full justify-center app-radius-md border app-border px-3 py-2 text-sm font-medium app-text-muted app-hover-surface"
        >
          Esqueci minha senha
        </Link>
        <Link
          href="/dashboard"
          className="mt-3 inline-flex w-full justify-center app-radius-md border border-emerald-300 px-3 py-2 text-sm font-medium app-text-success hover:bg-emerald-50"
        >
          Continuar sem entrar
        </Link>
      </form>
    </main>
  );
}
