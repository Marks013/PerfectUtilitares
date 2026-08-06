import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/auth/email";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";

type AppRole = "ADMIN" | "OPERATOR";
type AppUserStatus = "ACTIVE" | "BLOCKED" | "BANNED";

export type AppSession = {
  user: {
    id: string;
    tenantId?: string | null;
    email?: string | null;
    name?: string | null;
    image?: string | null;
    role: AppRole;
    status: AppUserStatus;
  };
  expires: string;
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId?: string | null;
      role: AppRole;
      status: AppUserStatus;
    } & DefaultSession["user"];
  }

  interface User {
    tenantId?: string | null;
    role: AppRole;
    status: AppUserStatus;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(BCRYPT_PASSWORD_MAX_LENGTH),
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

        if (user?.status !== "ACTIVE") {
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
          status: user.status,
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
        token.status = user.status;
      } else if (token.id) {
        const currentUser = await prisma.user.findUnique({
          where: { id: String(token.id) },
          select: {
            email: true,
            name: true,
            role: true,
            tenantId: true,
            status: true,
          },
        });

        if (currentUser) {
          token.email = currentUser.email;
          token.name = currentUser.name;
          token.role = currentUser.role;
          token.tenantId = currentUser.tenantId;
          token.status = currentUser.status;
        } else {
          token.status = "BANNED";
        }
      }

      return token;
    },
    session({ session, token }) {
      const tokenWithUser = token as typeof token & {
        id?: string;
        tenantId?: string | null;
        role?: AppRole;
        status?: AppUserStatus;
        email?: string | null;
        name?: string | null;
      };

      if (tokenWithUser.id && tokenWithUser.role) {
        session.user.id = tokenWithUser.id;
        session.user.email = tokenWithUser.email ?? session.user.email;
        session.user.name = tokenWithUser.name ?? session.user.name;
        session.user.tenantId = tokenWithUser.tenantId ?? null;
        session.user.role = tokenWithUser.role;
        session.user.status = tokenWithUser.status ?? "ACTIVE";
      }

      return session;
    },
  },
});
