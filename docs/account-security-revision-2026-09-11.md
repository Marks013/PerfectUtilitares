# Account session revision

## Problem and implementation plan

The previous security stamp included `User.updatedAt`. A successful name-only account PATCH advanced that timestamp and caused the next JWT refresh to reject the session. The original implementation was independently reproduced before modification with identical security fields and different cosmetic timestamps.

1. Add `User.securityVersion` with a non-null default of zero, preserving existing rows.
2. Advance it in a PostgreSQL row trigger only when password hash, email, role, status, or tenant actually changes. Keep the old revision when these values are unchanged, including attempted direct counter resets.
3. Use the revision in the existing HMAC stamp and select it when issuing password recovery links.
4. Validate account PATCH, JWT callbacks, administrative reversals, concurrent writes, direct SQL, tenant foreign-key cleanup, and recovery using a disposable database and synthetic identities.

No authentication fallback is introduced. Reversing a security change must never restore a previously issued JWT or recovery link. Keeping the rule in the database covers existing Prisma writers, the password rotation script, and foreign-key updates without duplicate application increments.

## Deployment and compatibility

The migration must run before the new application starts. It adds one integer column and a trigger, with no deletion or rewrite of application data. PostgreSQL takes the normal table lock for the additive DDL.

The DDL runs in one explicit transaction, so a failure cannot leave the new column installed without its trigger.

Existing JWT sessions and unconsumed password recovery links use the previous stamp format and will be invalidated once by this release. Users must sign in again or request a new recovery link. New name-only edits preserve sessions and recovery links. Normal invitation tokens do not use this stamp and retain their existing behavior.

For application rollback, keep the additive column and trigger rather than dropping data. The previous application can run against the expanded schema; switching stamp formats again requires sign-in and new recovery links. Restore the pre-release backup only under the normal explicit recovery procedure.

## Verification

Run `node verification/auth-revision-check.mjs` from `web/`. It creates and removes its own PostgreSQL container, applies the real migration history, and runs only the new verification file. Production accounts and email delivery are untouched. The tests capture the actual Auth.js JWT callback while substituting its session transport, and intercept outbound recovery email locally.

On 2026-09-11, all seven independent tests passed against PostgreSQL with the full migration history. `npx tsc --noEmit --pretty false` also passed. The disposable database was removed by the runner. Browser session transport and the final production build remain the integration/deployment lane's verification responsibility.

The primary implementation references are [PostgreSQL CREATE TRIGGER](https://www.postgresql.org/docs/17/sql-createtrigger.html), including column-specific triggers and distinct-value comparisons, and [Prisma custom database features](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features), which documents trigger SQL in migration files.
