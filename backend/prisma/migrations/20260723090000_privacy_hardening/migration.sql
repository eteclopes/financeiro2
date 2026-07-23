-- PRIVACIDADE: versões anteriores copiavam snapshots completos para audit_log,
-- incluindo valores, descrições e observações. A auditoria operacional não
-- precisa duplicar esses dados. Preservamos usuário/entidade/ação/data e
-- removemos apenas os snapshots antigos.
UPDATE "audit_log"
SET "old_value_json" = NULL,
    "new_value_json" = NULL
WHERE "old_value_json" IS NOT NULL
   OR "new_value_json" IS NOT NULL;

COMMENT ON COLUMN "audit_log"."old_value_json" IS
  'Metadados sanitizados; nunca armazenar valores financeiros ou dados pessoais.';
COMMENT ON COLUMN "audit_log"."new_value_json" IS
  'Metadados sanitizados; nunca armazenar valores financeiros ou dados pessoais.';

-- Ajuda futuras telas de segurança a buscar atividades do próprio usuário sem
-- varrer a tabela inteira. Não altera nenhuma regra financeira.
CREATE INDEX IF NOT EXISTS "audit_log_user_id_created_at_idx"
  ON "audit_log"("user_id", "created_at" DESC);
