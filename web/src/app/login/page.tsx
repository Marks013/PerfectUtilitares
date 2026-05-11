import { redirect } from "next/navigation";
import { Camera, Clock3, KeyRound, Sparkles } from "lucide-react";
import Link from "next/link";
import { auth } from "@/auth";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";
import { loginAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session && session.user.isActive !== false) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const errorMessageByCode: Record<string, string> = {
    missing: "Informe o e-mail e a senha para acessar o sistema.",
    email: "Informe um e-mail válido, como nome@empresa.com.",
    password: "Informe sua senha.",
    rate:
      "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.",
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
        <h1>Seu painel de jornadas e fotos, pronto para operar.</h1>
        <p>
          Entre para validar horários, gerar relatórios e preparar fotos 3x4 em
          uma área de trabalho organizada.
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
        className="login-gateway__form w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="size-5 text-neutral-500" aria-hidden="true" />
          <h2 className="text-xl font-semibold text-neutral-950">Entrar</h2>
        </div>
        <p className="mt-1 text-sm text-neutral-600">
          Use seu e-mail e senha para acessar o sistema.
        </p>

        {errorMessage ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}

        <label className="mt-5 block text-sm font-medium text-neutral-800">
          E-mail
          <input
            name="email"
            type="email"
            autoComplete="username"
            maxLength={254}
            required
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            placeholder="nome@empresa.com"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-neutral-800">
          Senha
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={BCRYPT_PASSWORD_MAX_LENGTH}
            required
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            placeholder="Digite sua senha"
          />
        </label>

        <button
          type="submit"
          className="mt-5 w-full rounded-md bg-neutral-950 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Entrar
        </button>
        <Link
          href="/esqueci-senha"
          className="mt-3 inline-flex w-full justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Esqueci minha senha
        </Link>
      </form>
    </main>
  );
}
