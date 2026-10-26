-- Additive scheduling storage. Published revisions are preserved; payroll is unchanged.
CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

CREATE TABLE "EscalaWorkspace" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "branchCode" TEXT NOT NULL,
  "branchName" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EscalaWorkspace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EscalaWorkspace_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED')),
  CONSTRAINT "EscalaWorkspace_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "EscalaWorkspace_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EscalaWorkspace_tenantId_id_key" ON "EscalaWorkspace"("tenantId", "id");
CREATE UNIQUE INDEX "EscalaWorkspace_tenantId_branchCode_startDate_endDate_key" ON "EscalaWorkspace"("tenantId", "branchCode", "startDate", "endDate");
CREATE INDEX "EscalaWorkspace_tenantId_branchCode_startDate_idx" ON "EscalaWorkspace"("tenantId", "branchCode", "startDate");

CREATE TABLE "EscalaRevision" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EscalaRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EscalaRevision_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED')),
  CONSTRAINT "EscalaRevision_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "EscalaRevision_tenantId_workspaceId_fkey" FOREIGN KEY ("tenantId", "workspaceId") REFERENCES "EscalaWorkspace"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EscalaRevision_tenantId_workspaceId_revision_key" ON "EscalaRevision"("tenantId", "workspaceId", "revision");
CREATE INDEX "EscalaRevision_tenantId_workspaceId_createdAt_idx" ON "EscalaRevision"("tenantId", "workspaceId", "createdAt");

CREATE TABLE "EscalaBranchAccess" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "branchCode" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EscalaBranchAccess_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EscalaBranchAccess_role_check" CHECK ("role" IN ('VIEWER', 'PLANNER', 'APPROVER')),
  CONSTRAINT "EscalaBranchAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EscalaBranchAccess_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EscalaBranchAccess_tenantId_userId_branchCode_key" ON "EscalaBranchAccess"("tenantId", "userId", "branchCode");
CREATE INDEX "EscalaBranchAccess_tenantId_branchCode_idx" ON "EscalaBranchAccess"("tenantId", "branchCode");

-- A transfer between companies must never carry branch privileges into the new tenant.
CREATE FUNCTION "escala_revoke_access_on_tenant_change"() RETURNS TRIGGER AS $$
BEGIN
  IF OLD."tenantId" IS DISTINCT FROM NEW."tenantId" THEN
    DELETE FROM "EscalaBranchAccess" WHERE "userId" = OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "User_revoke_escala_access_on_tenant_change"
BEFORE UPDATE OF "tenantId" ON "User"
FOR EACH ROW EXECUTE FUNCTION "escala_revoke_access_on_tenant_change"();
