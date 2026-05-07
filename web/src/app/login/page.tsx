import { redirect } from "next/navigation";
import { auth } from "@/auth";
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
  const errorMessage =
    params.error === "rate"
      ? "Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente."
      : "E-mail ou senha inválidos.";

  return (
    <main className="grid min-h-dvh place-items-center bg-neutral-100 px-4 py-8">
      <form
        action={loginAction}
        className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-xl font-semibold text-neutral-950">Entrar</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Acesse o sistema de jornadas e fotos 3x4.
        </p>

        {params.error ? (
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
            required
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
            placeholder="seuemail@empresa.com.br"
          />
        </label>

        <label className="mt-4 block text-sm font-medium text-neutral-800">
          Senha
          <input
            name="password"
            type="password"
            autoComplete="current-password"
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
      </form>
    </main>
  );
}
