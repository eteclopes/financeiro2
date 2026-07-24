-- Congela os totais financeiros exibidos em meses encerrados. O JSON evita
-- espalhar várias colunas de resumo e permite evoluir a versão do snapshot.
ALTER TABLE "months"
  ADD COLUMN "financial_snapshot" JSONB,
  ADD COLUMN "snapshot_version" SMALLINT;

CREATE INDEX "months_user_id_status_idx"
  ON "months" ("user_id", "status");
