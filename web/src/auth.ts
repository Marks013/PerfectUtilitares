import { createHash, randomUUID } from "node:crypto";
import NextAuth, { CredentialsSignin, type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/auth/email";
import { BCRYPT_PASSWORD_MAX_LENGTH } from "@/lib/auth/password";
import { getSecurityStamp } from "@/lib/auth/security-stamp";
import { siteSessionSecret } from "@/lib/auth/site-session-secret";
import { checkSharedRateLimit, getClientIp, getHashedRateLimitKey } from "@/lib/api/rate-limit";

type AppRole = "ADMIN" | "OPERATOR";
type AppUserStatus = "ACTIVE" | "BLOCKED" | "BANNED";

export type AppSession = {
  escalaSessionId?: string;
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
    escalaSessionId?: string;
    user: {
      id: string;
      tenantId?: string | null;
      role: AppRole;
      status: AppUserStatus;
    } & DefaultSession["user"];
  }

  interface User {
    securityStamp: string;
    tenantId?: string | null;
    role: AppRole;
    status: AppUserStatus;
  }
}

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(BCRYPT_PASSWORD_MAX_LENGTH),
});

// Valid cost-12 hash for equivalent bcrypt work when no active account exists.
// This value is not an account credential and is never accepted for login.
const DUMMY_PASSWORD_HASH = "$2b$12$9.Gr/l7nnkQ8zLyDDU7.8OdefMiA02tk3ugaiDv29H0aZalB/HVgm";
const LOGIN_ATTEMPT_WINDOW_MS = 5 * 60_000;

class LoginRateLimit extends CredentialsSignin {
  constructor(seconds: number) {
    super();
    // Auth.js may forward the code in a URL. It contains only a duration.
    this.code = `rate-${seconds}`;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: siteSessionSecret,
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
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const email = normalizeEmail(parsed.data.email);
        const clientIp = getClientIp(request.headers);
        // Both the form action and direct Auth.js callback enter this boundary.
        const limits = await Promise.all([
          checkSharedRateLimit(getHashedRateLimitKey("login", `${clientIp}\0${email}`), {
            limit: 8, windowMs: LOGIN_ATTEMPT_WINDOW_MS,
          }),
          checkSharedRateLimit(getHashedRateLimitKey("login-ip", clientIp), {
            limit: 80, windowMs: LOGIN_ATTEMPT_WINDOW_MS,
          }),
          checkSharedRateLimit(getHashedRateLimitKey("login-account", email), {
            limit: 12, windowMs: LOGIN_ATTEMPT_WINDOW_MS,
          }),
        ]);
        const blocked = limits.filter((limit) => limit.limited);
        if (blocked.length) {
          const resetAt = Math.max(...blocked.map((limit) => limit.resetAt));
          const seconds = Number.isFinite(resetAt)
            ? Math.max(1, Math.ceil((resetAt - Date.now()) / 1_000))
            : LOGIN_ATTEMPT_WINDOW_MS / 1_000;
          throw new LoginRateLimit(seconds);
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        const validPassword = await compare(
          parsed.data.password,
          user?.status === "ACTIVE" ? user.passwordHash : DUMMY_PASSWORD_HASH,
        );

        if (!validPassword || user?.status !== "ACTIVE") {
          return null;
        }

        return {
          securityStamp: getSecurityStamp(user),
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
        token.escalaSessionId = randomUUID();
        token.securityStamp = user.securityStamp;
        token.id = user.id;
        token.tenantId = user.tenantId;
        token.role = user.role;
        token.status = user.status;
      } else if (token.id) {
        const currentUser = await prisma.user.findUnique({
          where: { id: String(token.id) },
        });

        if (currentUser && token.securityStamp === getSecurityStamp(currentUser)) {
          token.email = currentUser.email;
          token.name = currentUser.name;
          token.role = currentUser.role;
          token.tenantId = currentUser.tenantId;
          token.status = currentUser.status;
        } else {
          return null;
        }
      }

      // Existing signed JWTs gain a stable identity without forcing every user to log in again.
      // Derive it once from the old random jti; subsequent JWT re-encodes preserve the claim.
      if (!token.escalaSessionId && typeof token.jti === "string") {
        token.escalaSessionId = createHash("sha256").update("escalas-session\0" + token.jti).digest("hex");
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

      if (typeof token.escalaSessionId === "string") session.escalaSessionId = token.escalaSessionId;
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
