-- ============================================================
-- Família de refresh tokens + detecção de reuso.
-- Aditivo: nenhuma sessão existente é invalidada.
-- ============================================================

ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" VARCHAR(36);

-- Backfill: cada token existente vira a raiz da própria família. Sessões
-- ativas continuam funcionando normalmente após o deploy.
UPDATE "refresh_tokens"
SET "family_id" = 'legacy-' || "id"::text
WHERE "family_id" IS NULL;

ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "refresh_tokens_family_id_idx"
  ON "refresh_tokens" ("family_id");

-- Consulta quente da rotação: token ativo de um usuário.
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_revoked_at_idx"
  ON "refresh_tokens" ("user_id", "revoked_at");
