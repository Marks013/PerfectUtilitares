import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/auth/email";

export type AppRole = "ADMIN" | "OPERATOR";

export type AppSession = {
  user: {
    id: string;
    tenantId?: string | null;
    email?: string | null;
    name?: string | null;
    image?: string | null;
    role: AppRole;
    isActive: boolean;
    canAccessJornada: boolean;
    canAccessFotos: boolean;
  };
  expires: string;
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId?: string | null;
      role: AppRole;
      isActive: boolean;
      canAccessJornada: boolean;
      canAccessFotos: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    tenantId?: string | null;
    role: AppRole;
    isActive: boolean;
    canAccessJornada: boolean;
    canAccessFotos: boolean;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const authSecret = process.env.AUTH_SECRET;

if (process.env.NODE_ENV === "production" && !authSecret) {
  throw new Error("AUTH_SECRET obrigatório em produção");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret ?? "dev-only-change-this-secret-before-production-deploy",
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: normalizeEmail(parsed.data.email) },
        });

        if (!user || !user.isActive) {
          return null;
        }

        const validPassword = await compare(
          parsed.data.password,
          user.passwordHash,
        );

        if (!validPassword) {
          return null;
        }

        return {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          name: user.name,
          role: user.role,
          isActive: user.isActive,
          canAccessJornada: user.canAccessJornada,
          canAccessFotos: user.canAccessFotos,
        };
      },
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      const publicBaseUrl = process.env.APP_URL ?? process.env.AUTH_URL ?? baseUrl;

      if (url.startsWith("/")) {
        return `${publicBaseUrl}${url}`;
      }

      try {
        const targetUrl = new URL(url);
        const publicUrl = new URL(publicBaseUrl);

        if (
          targetUrl.origin === publicUrl.origin ||
          targetUrl.origin === baseUrl ||
          ["localhost", "127.0.0.1", "0.0.0.0"].includes(targetUrl.hostname)
        ) {
          return `${publicUrl.origin}${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
        }
      } catch {
        return publicBaseUrl;
      }

      return publicBaseUrl;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.tenantId = user.tenantId;
        token.role = user.role;
        token.isActive = user.isActive;
        token.canAccessJornada = user.canAccessJornada;
        token.canAccessFotos = user.canAccessFotos;
      } else if (token.id) {
        const currentUser = await prisma.user.findUnique({
          where: { id: String(token.id) },
          select: {
            role: true,
            tenantId: true,
            isActive: true,
            canAccessJornada: true,
            canAccessFotos: true,
          },
        });

        if (currentUser) {
          token.role = currentUser.role;
          token.tenantId = currentUser.tenantId;
          token.isActive = currentUser.isActive;
          token.canAccessJornada = currentUser.canAccessJornada;
          token.canAccessFotos = currentUser.canAccessFotos;
        } else {
          token.isActive = false;
        }
      }

      return token;
    },
    session({ session, token }) {
      const tokenWithUser = token as typeof token & {
        id?: string;
        tenantId?: string | null;
        role?: AppRole;
        isActive?: boolean;
        canAccessJornada?: boolean;
        canAccessFotos?: boolean;
      };

      if (tokenWithUser.id && tokenWithUser.role) {
        session.user.id = tokenWithUser.id;
        session.user.tenantId = tokenWithUser.tenantId ?? null;
        session.user.role = tokenWithUser.role;
        session.user.isActive = tokenWithUser.isActive ?? true;
        session.user.canAccessJornada = tokenWithUser.canAccessJornada ?? true;
        session.user.canAccessFotos = tokenWithUser.canAccessFotos ?? true;
      }

      return session;
    },
  },
});
