# PerfectUtilitares repository instructions

Scope: this repository and all subdirectories.

## Working rules

- Production work runs on the server in `/home/ubuntu/PerfectUtilitares`.
- The web application is in `web/` and uses npm with the committed lockfile.
- Preserve mounted data, templates, storage, database state, and user changes.
- Never print, copy, commit, or relax permissions on `.env`, credentials, or keys.
- Do not modify deployment secrets as part of tests or seed data.
- Prefer focused patches and existing patterns; avoid unrelated formatting churn.

## Required checks

- Add a real success-path test for every changed API route. Auth/origin/method-only tests are insufficient.
- Run targeted Vitest files while editing.
- Before release, run `npm run quality` once, then `npm run build` once.
- Validate Compose with access to protected env files before deployment.
- Run browser E2E smoke tests after the production build/deploy.
- Do not repeatedly rebuild containers during implementation.

## Security and data

- Administrative users are bootstrapped only when absent.
- Password rotation is explicit through `npm run admin:rotate-password`.
- Upload boundaries must validate type, size, content, and tenant authorization.
- Logs and monitoring must not contain credentials or personal payload data.

## Release discipline

- Keep the worktree reviewable and document verification evidence.
- Deploy only after targeted tests and the final quality gate pass.
- Verify health checks and critical public/authenticated flows after deployment.
- Do not rewrite Git history or remove unrelated files.
