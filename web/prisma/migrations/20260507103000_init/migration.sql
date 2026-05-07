-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CodigoOrigem" AS ENUM ('XLSX', 'CSV', 'JSON', 'MANUAL');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR');

-- CreateTable
CREATE TABLE "CodigoJornada" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "horariosOriginal" TEXT NOT NULL,
    "horariosNormalizado" TEXT NOT NULL,
    "origem" "CodigoOrigem" NOT NULL DEFAULT 'MANUAL',
    "linha" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodigoJornada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JornadaRule" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "duracaoMinutos" INTEGER NOT NULL,
    "horasSemanais" INTEGER NOT NULL,
    "horasMensais" INTEGER NOT NULL,
    "intervaloMin" INTEGER NOT NULL,
    "intervaloMax" INTEGER NOT NULL,
    "diasValidos" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JornadaRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JornadaValidation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "horariosOriginal" TEXT NOT NULL,
    "horariosNormalizado" TEXT NOT NULL,
    "valido" BOOLEAN NOT NULL,
    "mensagem" TEXT NOT NULL,
    "duracaoCalculada" TEXT,
    "tipoDia" TEXT NOT NULL,
    "codigo" TEXT,
    "horasSemanais" INTEGER,
    "horasMensais" INTEGER,
    "intervalo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JornadaValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CodigoJornada_horariosNormalizado_key" ON "CodigoJornada"("horariosNormalizado");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "JornadaRule_nome_key" ON "JornadaRule"("nome");

-- CreateIndex
CREATE INDEX "JornadaValidation_createdAt_idx" ON "JornadaValidation"("createdAt");

-- CreateIndex
CREATE INDEX "JornadaValidation_valido_idx" ON "JornadaValidation"("valido");

-- CreateIndex
CREATE INDEX "JornadaValidation_userId_idx" ON "JornadaValidation"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- AddForeignKey
ALTER TABLE "JornadaValidation" ADD CONSTRAINT "JornadaValidation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
