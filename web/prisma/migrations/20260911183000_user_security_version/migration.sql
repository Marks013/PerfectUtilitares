-- Cosmetic profile edits must not revoke sessions or recovery links. Keep the
-- revocation counter in PostgreSQL so Prisma, SQL, and FK updates share the rule.
BEGIN;

ALTER TABLE "User" ADD COLUMN "securityVersion" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION advance_user_security_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."passwordHash", NEW."email", NEW."role", NEW."status", NEW."tenantId")
     IS DISTINCT FROM
     ROW(OLD."passwordHash", OLD."email", OLD."role", OLD."status", OLD."tenantId")
  THEN
    NEW."securityVersion" := OLD."securityVersion" + 1;
  ELSE
    NEW."securityVersion" := OLD."securityVersion";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_security_version_before_update
BEFORE UPDATE OF "passwordHash", "email", "role", "status", "tenantId", "securityVersion"
ON "User"
FOR EACH ROW EXECUTE FUNCTION advance_user_security_version();

COMMIT;
