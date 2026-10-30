CREATE TYPE "EscalaSolveState" AS ENUM ('CREATED', 'RUNNING', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', 'FAILED', 'TIMED_OUT');
CREATE TABLE "EscalaSolveOperation" (
  "id" UUID NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "expectedRevision" INTEGER NOT NULL,
  "ownerKey" VARCHAR(64) NOT NULL,
  "state" "EscalaSolveState" NOT NULL DEFAULT 'CREATED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EscalaSolveOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EscalaSolveOperation_workspace_fkey" FOREIGN KEY ("tenantId", "workspaceId") REFERENCES "EscalaWorkspace"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EscalaSolveOperation_tenantId_ownerKey_state_expiresAt_idx" ON "EscalaSolveOperation"("tenantId", "ownerKey", "state", "expiresAt");
CREATE INDEX "EscalaSolveOperation_tenantId_workspaceId_idx" ON "EscalaSolveOperation"("tenantId", "workspaceId");
CREATE INDEX "EscalaSolveOperation_expiresAt_idx" ON "EscalaSolveOperation"("expiresAt");
-- One active operation per authenticated session, enforced across concurrent requests.
CREATE UNIQUE INDEX "EscalaSolveOperation_active_owner_key" ON "EscalaSolveOperation"("tenantId", "ownerKey") WHERE "state" IN ('CREATED', 'RUNNING', 'CANCEL_REQUESTED');
