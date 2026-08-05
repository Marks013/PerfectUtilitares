-- A busca permanece ILIKE/contains; pg_trgm acelera titulares e dependentes
-- sem alterar normalização, acentuação ou ordenação dos resultados.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "UnimedBeneficiary_fullName_trgm_idx"
  ON "UnimedBeneficiary"
  USING GIN ("fullName" gin_trgm_ops);

-- Rollback seguro:
-- DROP INDEX "UnimedBeneficiary_fullName_trgm_idx";
-- A extensão pg_trgm é compartilhada e não deve ser removida no rollback.
