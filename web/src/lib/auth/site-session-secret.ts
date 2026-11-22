const authSecret = process.env.AUTH_SECRET;

if (process.env.NODE_ENV === "production" && !authSecret) {
  throw new Error("AUTH_SECRET obrigatório em produção");
}

export const siteSessionSecret = authSecret ?? "dev-only-change-this-secret-before-production-deploy";
