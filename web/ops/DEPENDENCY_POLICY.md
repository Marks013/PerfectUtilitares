# Dependency policy

Status: active operational policy.

`next-auth@5.0.0-beta.32` is intentionally pinned because the application uses
the Auth.js v5 API with Next.js 16. It is a pre-release dependency, not a
deprecated package.

Any update must pass `src/auth.test.ts`, which covers invalid and valid
credentials, password verification, safe user projection, redirect origin
validation, JWT authorization refresh, deleted users, and session projection.
Production release also requires the browser authentication smoke suite.

Replace this exception when a stable Auth.js v5 release compatible with the
current Next.js version is available and validated.
