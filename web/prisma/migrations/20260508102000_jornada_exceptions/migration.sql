-- CreateTable
CREATE TABLE "JornadaException" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nome" TEXT,
    "horariosOriginal" TEXT NOT NULL,
    "horariosNormalizado" TEXT NOT NULL,
    "sabadoOriginal" TEXT,
    "sabadoNormalizado" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JornadaException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JornadaException_userId_idx" ON "JornadaException"("userId");

-- CreateIndex
CREATE INDEX "JornadaException_active_idx" ON "JornadaException"("active");

-- CreateIndex
CREATE INDEX "JornadaException_horariosNormalizado_idx" ON "JornadaException"("horariosNormalizado");

-- CreateIndex
CREATE INDEX "JornadaException_sabadoNormalizado_idx" ON "JornadaException"("sabadoNormalizado");

-- AddForeignKey
ALTER TABLE "JornadaException" ADD CONSTRAINT "JornadaException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

