CREATE TABLE "ShiftCatalogSequence" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "nextCode" INTEGER NOT NULL DEFAULT 1500,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShiftCatalogSequence_nextCode_check" CHECK ("nextCode" >= 1500),
  CONSTRAINT "ShiftCatalogSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShiftCatalogSequence_tenantId_key"
  ON "ShiftCatalogSequence"("tenantId");

CREATE TABLE "ShiftCatalogEntry" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "code" INTEGER NOT NULL,
  "firstIn" INTEGER NOT NULL,
  "firstOut" INTEGER NOT NULL,
  "secondIn" INTEGER NOT NULL,
  "secondOut" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShiftCatalogEntry_code_check" CHECK ("code" >= 1500),
  CONSTRAINT "ShiftCatalogEntry_first_period_check" CHECK ("firstIn" >= 0 AND "firstIn" < 1440 AND "firstOut" > "firstIn" AND "firstOut" < 1440),
  CONSTRAINT "ShiftCatalogEntry_second_period_check" CHECK (("secondIn" = 0 AND "secondOut" = 0) OR ("secondIn" >= "firstOut" AND "secondOut" > "secondIn" AND "secondOut" < 1440)),
  CONSTRAINT "ShiftCatalogEntry_zero_tuple_check" CHECK (NOT ("firstIn" = 0 AND "firstOut" = 0 AND "secondIn" = 0 AND "secondOut" = 0)),
  CONSTRAINT "ShiftCatalogEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shift_catalog_tenant_code_key"
  ON "ShiftCatalogEntry"("tenantId", "code");
CREATE UNIQUE INDEX "shift_catalog_tenant_clocks_key"
  ON "ShiftCatalogEntry"("tenantId", "firstIn", "firstOut", "secondIn", "secondOut");

CREATE TABLE "TurnoExportManifest" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdByAccountSessionId" TEXT,
  "createdByModuleSessionId" TEXT,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TurnoExportManifest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "turno_export_manifest_tenant_id_key"
  ON "TurnoExportManifest"("tenantId", "id");
CREATE INDEX "turno_export_manifest_tenant_expires_idx"
  ON "TurnoExportManifest"("tenantId", "expiresAt");

ALTER TABLE "ShiftCatalogSequence"
  ADD CONSTRAINT "ShiftCatalogSequence_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShiftCatalogEntry"
  ADD CONSTRAINT "ShiftCatalogEntry_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TurnoExportManifest"
  ADD CONSTRAINT "TurnoExportManifest_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
